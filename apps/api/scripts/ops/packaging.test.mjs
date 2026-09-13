import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { root } from './common.mjs';

// Real Git + packager + pnpm; the tiny build is local and has no dependencies.
// Every commit and generated artifact belongs to a disposable fixture repository.
const temporary = [];
after(() => temporary.forEach(path => rmSync(path, { recursive: true, force: true })));
function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'yanqing-packaging-test-'));
  temporary.push(base);
  const repo = join(base, 'repo'); mkdirSync(repo);
  const put = (path, text) => { const target = join(repo, path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, text); };
  put('scripts/prepare-api-release.py', '');
  copyFileSync(root + 'scripts/prepare-api-release.py', join(repo, 'scripts/prepare-api-release.py'));
  put('package.json', JSON.stringify({ private: true, scripts: { 'build:api': 'node apps/api/build.cjs' } }));
  put('pnpm-workspace.yaml', 'packages:\n  - apps/*\n  - packages/*\n');
  put('pnpm-lock.yaml', "lockfileVersion: '9.0'\n");
  put('tsconfig.json', '{}\n');
  put('.gitignore', '**/dist/\n');
  put('apps/api/prisma/schema.prisma', '// fixture schema\n');
  put('apps/api/prisma/migrations/fixture/migration.sql', 'SELECT 1;\n');
  put('packages/shared/package.json', '{"name":"fixture-shared"}\n');
  put('deploy/ops/README', 'fixture\n');
  put('apps/api/build.cjs', `const fs = require('node:fs');
const cp = require('node:child_process');
for (const dir of ['apps/api/dist', 'packages/shared/dist']) {
  fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(dir + '/index.js', 'committed fixture build');
}
fs.writeFileSync('build-ran', 'yes');
if (process.env.FIXTURE_CHANGE === 'input') fs.appendFileSync('pnpm-workspace.yaml', '# changed during build\\n');
if (process.env.FIXTURE_CHANGE === 'head') cp.execFileSync('git', ['commit', '--allow-empty', '-m', 'fixture head changed']);
`);
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
  };
  git('init', '--quiet'); git('config', 'user.name', 'Local fixture'); git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'commit.gpgsign', 'false'); git('add', '.'); git('commit', '--quiet', '-m', 'fixture');
  const commit = git('rev-parse', 'HEAD');
  const out = join(base, 'release');
  const run = (env = {}) => spawnSync('python3', ['scripts/prepare-api-release.py', out], {
    cwd: repo, encoding: 'utf8', timeout: 30000, env: { ...process.env, ...env },
  });
  return { repo, out, commit, put, run };
}

test('clean packaging records the pinned commit and includes root build manifests', () => {
  const f = fixture(); const result = f.run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const metadata = JSON.parse(readFileSync(join(f.out, 'stage/RELEASE.json'), 'utf8'));
  assert.equal(metadata.commit, f.commit);
  assert.equal(readFileSync(join(f.out, 'stage/apps/api/dist/index.js'), 'utf8'), 'committed fixture build');
  assert(existsSync(join(f.out, 'stage/package.json')));
  assert(existsSync(join(f.out, 'stage/pnpm-workspace.yaml')));
  assert(existsSync(join(f.out, 'release.tgz')));
});

for (const input of ['package.json', 'pnpm-workspace.yaml', 'tsconfig.json', '.npmrc']) {
  test(`uncommitted ${input} blocks packaging before build`, () => {
    const f = fixture(); f.put(input, input === 'package.json' ? '{"private":true}' : '# local change\n');
    const result = f.run(); assert.notEqual(result.status, 0);
    assert(!existsSync(join(f.repo, 'build-ran'))); assert(!existsSync(f.out));
  });
}

for (const change of ['input', 'head']) {
  test(`changing ${change} during build prevents a falsely attributed release`, () => {
    const f = fixture(); const result = f.run({ FIXTURE_CHANGE: change });
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert(existsSync(join(f.repo, 'build-ran'))); assert(!existsSync(f.out));
  });
}
