import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync, copyFileSync, chmodSync, existsSync, realpathSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { validateRelease, packageDigest } from './release-miniapp.mjs'
const build = { commit: 'a'.repeat(40), version: '1.0.11', dataMode: 'remote', apiBase: 'https://api.yutechhn.cn/api/v1', dirty: false }
const config = { appid: 'wx25610460bc96894b', compileType: 'miniprogram' }
test('blocks stale, dirty, mock and wrong-target packages before upload', () => {
  validateRelease(build, config, build)
  for (const update of [{ commit: 'b'.repeat(40) }, { version: '1.0.10' }, { dirty: true }, { dataMode: 'mock' }, { apiBase: 'http://127.0.0.1:3200/api/v1' }]) {
    assert.throws(() => validateRelease({ ...build, ...update }, config, build))
  }
  assert.throws(() => validateRelease(build, { ...config, appid: 'wrong' }, build))
  assert.throws(() => validateRelease(build, { ...config, compileType: 'game' }, build))
})
test('detects changed package content while ignoring local developer-tool preferences', () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'miniapp-release-'))
  try {
    writeFileSync(path.join(folder, 'app.js'), 'first')
    const digest = packageDigest(folder)
    writeFileSync(path.join(folder, 'project.private.config.json'), '{}')
    assert.equal(packageDigest(folder), digest)
    writeFileSync(path.join(folder, 'app.js'), 'changed')
    assert.notEqual(packageDigest(folder), digest)
  } finally { rmSync(folder, { recursive: true, force: true }) }
})


// Exercise the actual command entrypoint in an isolated repository. Only the
// Git/build, package-audit, network and WeChat CLI boundaries are replaced.
function releaseFixture(t) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'miniapp-upload-integration-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const project = path.join(root, 'apps/miniapp/dist/build/mp-weixin')
  const scripts = path.join(root, 'apps/miniapp/scripts')
  const bin = path.join(root, 'bin')
  for (const folder of [project, scripts, bin, path.join(root, 'scripts')]) mkdirSync(folder, { recursive: true })
  const command = path.join(root, 'scripts/release-miniapp.mjs')
  copyFileSync(new URL('./release-miniapp.mjs', import.meta.url), command)
  writeFileSync(path.join(scripts, 'release-metadata.mjs'), `
    export const repository = ${JSON.stringify(root)};
    export const releaseInputs = [];
    export const git = (...args) => args[0] === 'rev-parse' ? ${JSON.stringify(build.commit)} : '';
  `)
  writeFileSync(path.join(scripts, 'check-wechat-package.mjs'), `
    export const auditWechatPackage = () => ({ ok: true, totalBytes: 100, mainBytes: 100 });
  `)
  writeFileSync(path.join(root, 'apps/miniapp/package.json'), JSON.stringify({ version: build.version }))
  function executable(name, source) {
    const file = path.join(bin, name)
    writeFileSync(file, '#!/usr/bin/env node\n' + source)
    chmodSync(file, 0o755)
    return file
  }
  executable('pnpm', `
    const fs = require('node:fs'), path = require('node:path');
    const output = process.env.UNI_OUTPUT_DIR;
    if (!output) throw new Error('build output must be explicit');
    fs.mkdirSync(output, { recursive: true });
    for (const [file, data] of Object.entries(${JSON.stringify({
      'release-info.json': JSON.stringify(build),
      'project.config.json': JSON.stringify(config),
      'app.js': 'verified original package',
      'app.wxss': '.page { color: #123; }',
    })})) fs.writeFileSync(path.join(output, file), data);
  `)
  const compiler = executable('wcsc', `
    const fs = require('node:fs');
    if (!fs.existsSync(process.argv[2])) throw new Error('stylesheet missing in compiler cwd');
  `)
  const uploadedFile = path.join(root, 'uploaded.json')
  const cli = executable('wechat-cli', `
    const fs = require('node:fs'), path = require('node:path');
    const args = process.argv.slice(2);
    if (args[0] !== 'upload') throw new Error('unexpected CLI action');
    const project = args[args.indexOf('--project') + 1];
    if (!project) throw new Error('missing --project');
    fs.writeFileSync(${JSON.stringify(uploadedFile)}, JSON.stringify({
      project, contents: fs.readFileSync(path.join(project, 'app.js'), 'utf8'),
      version: args[args.indexOf('--version') + 1],
    }));
  `)
  const preload = path.join(root, 'health-stub.mjs')
  writeFileSync(preload, `
    import { writeFileSync } from 'node:fs';
    globalThis.fetch = async (url) => {
      if (url !== 'https://api.yutechhn.cn/api/v1/health/ready') throw new Error('unexpected network call');
      if (process.env.TEST_MUTATE_PACKAGE) writeFileSync(process.env.TEST_MUTATE_PACKAGE, 'changed during health request');
      return { ok: true, json: async () => ({ code: 0, data: {
        status: 'ok', revision: ${JSON.stringify(build.commit)}, checks: { database: 'ok' },
      } }) };
    };
  `)
  const directory = path.join(root, 'output/releases', `${build.version}-${build.commit.slice(0, 12)}`)
  const receiptFile = path.join(directory, 'miniapp-release.json')
  const lockFile = path.join(root, 'output/.miniapp-release.lock')
  const receipt = () => JSON.parse(readFileSync(receiptFile, 'utf8'))
  const run = (mode, extraEnv = {}) => spawnSync(process.execPath, ['--import', preload, command, mode], {
    cwd: root, encoding: 'utf8', timeout: 15000,
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, WECHAT_WXSS_COMPILER: compiler, WECHAT_CLI: cli, ...extraEnv },
  })
  const prepare = () => {
    const result = run('prepare')
    assert.equal(result.status, 0, result.stderr || result.stdout)
    const prepared = receipt()
    assert.match(prepared.packageFolder, /^package-[A-Za-z0-9]+$/)
    const snapshot = path.join(directory, prepared.packageFolder)
    assert.equal(packageDigest(snapshot), prepared.digest)
    assert.equal(prepared.upload, 'pending')
    assert.equal(existsSync(lockFile), false, 'prepare must release its lock')
    return snapshot
  }
  return { project, directory, receipt, lockFile, uploadedFile, prepare, run }
}

test('uploads the prepared snapshot when a concurrent build rewrites source dist during readiness', (t) => {
  const fixture = releaseFixture(t)
  const snapshot = fixture.prepare()
  const result = fixture.run('upload', { TEST_MUTATE_PACKAGE: path.join(fixture.project, 'app.js') })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.equal(readFileSync(path.join(fixture.project, 'app.js'), 'utf8'), 'changed during health request')
  const uploaded = JSON.parse(readFileSync(fixture.uploadedFile, 'utf8'))
  assert.equal(uploaded.project, snapshot)
  assert.equal(uploaded.contents, 'verified original package')
  assert.equal(uploaded.version, build.version)
  assert.equal(fixture.receipt().digest, packageDigest(snapshot))
  assert.equal(fixture.receipt().upload, 'succeeded')
  assert.equal(fixture.receipt().experienceVersion, 'unverified')
  assert.equal(existsSync(fixture.lockFile), false, 'upload must release its lock')
})

test('rejects a snapshot changed during readiness before invoking the upload CLI', (t) => {
  const fixture = releaseFixture(t)
  const snapshot = fixture.prepare()
  const result = fixture.run('upload', { TEST_MUTATE_PACKAGE: path.join(snapshot, 'app.js') })
  assert.notEqual(result.status, 0, 'snapshot changed after the first digest check')
  assert.equal(existsSync(fixture.uploadedFile), false)
  assert.equal(fixture.receipt().upload, 'pending')
  assert.notEqual(fixture.receipt().digest, packageDigest(snapshot))
  assert.equal(existsSync(fixture.lockFile), false, 'failed upload must release its own lock')
})

test('prepare and upload refuse an existing release lock without removing another owner lock', (t) => {
  const fixture = releaseFixture(t)
  fixture.prepare()
  writeFileSync(fixture.lockFile, 'another release owns this lock')
  for (const mode of ['prepare', 'upload']) {
    const result = fixture.run(mode)
    assert.notEqual(result.status, 0, `${mode} must refuse concurrent release work`)
    assert.equal(readFileSync(fixture.lockFile, 'utf8'), 'another release owns this lock')
    assert.equal(fixture.receipt().upload, 'pending')
    assert.equal(existsSync(fixture.uploadedFile), false)
  }
})
