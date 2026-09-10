import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { apiDependencyFingerprint, checkReadiness, root, sha256 } from './common.mjs';

test('API dependency reuse rejects changed server importers and resolutions, allowing unrelated client importers', () => {
  const lock = readFileSync(root + 'pnpm-lock.yaml', 'utf8');
  const hash = apiDependencyFingerprint(lock);
  assert.equal(apiDependencyFingerprint(lock.replace('  apps/miniapp:\n', '  apps/miniapp:\n    clientOnly: true\n')), hash);
  assert.notEqual(apiDependencyFingerprint(lock.replace('  apps/api:\n', '  apps/api:\n    serverChange: true\n')), hash);
  assert.notEqual(apiDependencyFingerprint(lock.replace('\npackages:\n', '\npackages:\n  changed-resolution:\n')), hash);
  assert.throws(() => apiDependencyFingerprint('unknown lock format'));
});

test('readiness requires the actual database signal and exact serving commit', async () => {
  let status = 200;
  let data = { service: 'yanqing-api', revision: 'a'.repeat(40), checks: { database: 'ok' } };
  const server = createServer((req, res) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ code: 0, data })); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}/api/v1`;
    await checkReadiness(base, 'a'.repeat(40));
    await assert.rejects(checkReadiness(base, 'b'.repeat(40)));
    status = 503;
    await assert.rejects(checkReadiness(base, 'a'.repeat(40)));
    status = 200; data = { service: 'yanqing-api', revision: 'a'.repeat(40) };
    await assert.rejects(checkReadiness(base, 'a'.repeat(40)));
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

// Exercise the real release shell with an isolated filesystem and fake systemd,
// HTTP and DB checks. These tests never restart a host service or restore data.
const temporary = [];
after(() => { for (const path of temporary) rmSync(path, { recursive: true, force: true }); });
function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'yanqing-release-test-')); temporary.push(base);
  const bin = join(base, 'bin'); mkdirSync(bin);
  const commit = 'a'.repeat(40);
  const candidate = join(base, 'releases/api-' + commit.slice(0, 12));
  const previous = join(base, 'releases/api-previous');
  const receipt = join(base, 'ops/receipts', commit);
  mkdirSync(candidate, { recursive: true }); mkdirSync(previous, { recursive: true }); mkdirSync(receipt, { recursive: true });
  const override = join(base, '90-release.conf');
  const oldConfig = `[Service]\nWorkingDirectory=${previous}\nEnvironment=DEV_LOGIN_ENABLED=false\n`;
  writeFileSync(override, oldConfig); writeFileSync(join(receipt, '90-release.conf'), oldConfig);
  writeFileSync(join(receipt, 'previous-release'), previous + '\n'); writeFileSync(join(receipt, 'rehearsed'), '');
  writeFileSync(join(base, '.env.api'), 'TEST=true\n'); writeFileSync(join(base, '.env.boss'), 'TEST=true\n');
  writeFileSync(join(receipt, 'environment.sha256'), ['.env.api', '.env.boss'].map(name => sha256(readFileSync(join(base, name))) + '  ' + join(base, name)).join('\n') + '\n');
  writeFileSync(join(candidate, 'payload'), 'verified build');
  writeFileSync(join(candidate, 'FILES.sha256'), sha256('verified build') + '  payload\n');
  writeFileSync(join(receipt, 'database.dump'), 'verified backup');
  writeFileSync(join(receipt, 'backup.json'), JSON.stringify({ commit, restored: true, rehearsal: true, completedAt: new Date().toISOString(), directory: receipt, dumpSha256: sha256('verified backup') }));
  const state = join(base, 'active'); writeFileSync(state, previous);
  const script = (name, body) => writeFileSync(join(bin, name), body, { mode: 0o755 });
  script('sudo', '#!/bin/sh\nexec "$@"\n');
  for (const name of ['flock', 'sleep', 'curl']) script(name, '#!/bin/sh\nexit 0\n');
  script('systemctl', `#!/usr/bin/env node
const fs=require('fs'),args=process.argv.slice(2);
if(args[0]==='show') console.log(fs.readFileSync(process.env.FAKE_STATE,'utf8'));
if(args[0]==='restart') {const path=fs.readFileSync(process.env.OPS_SYSTEMD_OVERRIDE,'utf8').match(/^WorkingDirectory=(.+)$/m)[1];if(process.env.FAKE_ROLLBACK_FAIL==='1'&&path.endsWith('api-previous'))process.exit(1);fs.writeFileSync(process.env.FAKE_STATE,path);}
`);
  script('node-wrapper', `#!/usr/bin/env node
const {spawnSync}=require('child_process');
const args=process.argv.slice(2);
if(args.some(arg=>arg.endsWith('/check-release.mjs'))) { process.exit(args.includes('--database-only')?0:Number(process.env.FAKE_FAIL_READY||0)); }
const child=spawnSync(process.execPath,args,{stdio:'inherit'});process.exit(child.status??1);
`);
  script('sha256sum', `#!/usr/bin/env node
const fs=require('fs'),crypto=require('crypto'),args=process.argv.slice(2);
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
if(args[0]==='-c'){ for(const line of fs.readFileSync(args[1],'utf8').trim().split('\\n')){const [expected,path]=line.split('  ');if(hash(path)!==expected)process.exit(1);} }
else {for(const path of args)console.log(hash(path)+'  '+path);}
`);
  const env = { ...process.env, PATH: bin + ':' + dirname(process.execPath) + ':' + process.env.PATH,
    OPS_BASE: base, OPS_NODE: join(bin, 'node-wrapper'), OPS_SYSTEMD_OVERRIDE: override, FAKE_STATE: state };
  const run = (extra = {}, action = 'activate') => spawnSync('bash', [root + 'deploy/ops/release.sh', action, commit], { env: { ...env, ...extra }, encoding: 'utf8', timeout: 15000 });
  return { run, candidate, previous, receipt, state, override, oldConfig };
}

test('successful activation records the version and preserves development-login closure', () => {
  const f = fixture(); const result = f.run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(readFileSync(f.state, 'utf8'), f.candidate);
  assert.match(readFileSync(f.override, 'utf8'), /Environment=DEV_LOGIN_ENABLED=false/);
  assert(existsSync(join(f.receipt, 'activated-at')));
});

test('failed candidate readiness restores the exact previous application configuration', () => {
  const f = fixture(); const result = f.run({ FAKE_FAIL_READY: '1' });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /ROLLBACK_OK/);
  assert.equal(readFileSync(f.state, 'utf8'), f.previous);
  assert.equal(readFileSync(f.override, 'utf8'), f.oldConfig);
  assert(!existsSync(join(f.receipt, 'activated-at')));
  assert.equal(readFileSync(join(f.receipt, 'database.dump'), 'utf8'), 'verified backup');
});

test('changed backup or active release blocks activation before modifying the service', () => {
  const f = fixture(); writeFileSync(join(f.receipt, 'database.dump'), 'corrupt');
  assert.notEqual(f.run().status, 0);
  assert.equal(readFileSync(f.override, 'utf8'), f.oldConfig);
  const other = fixture(); writeFileSync(other.state, 'a different release');
  assert.notEqual(other.run().status, 0);
  assert.equal(readFileSync(other.override, 'utf8'), other.oldConfig);
});

test('manual rollback restores the recorded application without restoring the database', () => {
  const f = fixture(); assert.equal(f.run().status, 0);
  const result = f.run({}, 'rollback');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(readFileSync(f.state, 'utf8'), f.previous);
  assert.equal(readFileSync(f.override, 'utf8'), f.oldConfig);
  assert.equal(readFileSync(join(f.receipt, 'database.dump'), 'utf8'), 'verified backup');
});

test('a failed rollback restart is reported as failure and never marked healthy', () => {
  const f = fixture(); const result = f.run({ FAKE_FAIL_READY: '1', FAKE_ROLLBACK_FAIL: '1' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ROLLBACK_FAILED/);
  assert.doesNotMatch(result.stdout, /ROLLBACK_OK/);
  assert(!existsSync(join(f.receipt, 'rolled-back-at')));
});
