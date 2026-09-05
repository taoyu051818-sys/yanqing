import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { auditWechatPackage, MEDIA_LIMIT_BYTES } from './check-wechat-package.mjs'

function fixture(t, files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yanqing-package-test-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const entries = {
    'app.json': JSON.stringify({ pages: ['pages/home/index'], subPackages: [{ root: 'packages/ops', pages: ['pages/index'] }] }),
    'app.js': 'require("./common/vendor.js")',
    'common/vendor.js': '',
    'pages/home/index.js': '',
    'packages/ops/pages/index.js': 'require("../config/governance.js")',
    'packages/ops/config/governance.js': 'exports.enabled = true',
    ...files,
  }
  for (const [name, contents] of Object.entries(entries)) {
    const target = path.join(root, name)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, contents)
  }
  return root
}

test('allows ops-only JS inside the ops subpackage', t => {
  assert.equal(auditWechatPackage(fixture(t)).ok, true)
})
test('rejects a main-package helper referenced only by an ops page', t => {
  const result = auditWechatPackage(fixture(t, {
    'config/governance.js': 'exports.enabled = true',
    'packages/ops/pages/index.js': 'require("../../../config/governance.js")',
  }))
  assert.deepEqual(result.unusedMainJs, ['config/governance.js'])
})
test('follows main-page component JSON and transitive JS dependencies', t => {
  const result = auditWechatPackage(fixture(t, {
    'pages/home/index.json': JSON.stringify({ usingComponents: { icon: '../../components/icon' } }),
    'components/icon.js': 'require("../utils/icon.js")',
    'utils/icon.js': '',
  }))
  assert.equal(result.ok, true)
})
test('rejects media above 200000 bytes, including subpackage audio', t => {
  const result = auditWechatPackage(fixture(t, { 'packages/ops/static/music.mp3': Buffer.alloc(MEDIA_LIMIT_BYTES + 1) }))
  assert.equal(result.oversizedMedia.length, 1)
  assert.equal(result.ok, false)
})
test('accepts an image exactly at the strict 200 KB boundary', t => {
  assert.equal(auditWechatPackage(fixture(t, { 'static/share.jpg': Buffer.alloc(MEDIA_LIMIT_BYTES) })).ok, true)
})
test('rejects even reachable mock data in remote builds, but permits an explicit mock build', t => {
  const root = fixture(t, { 'pages/home/index.js': 'require("../../services/mock/state.js")', 'services/mock/state.js': '' })
  assert.deepEqual(auditWechatPackage(root).mockFiles, ['services/mock/state.js'])
  assert.equal(auditWechatPackage(root, { remote: false }).ok, true)
})
test('detects broken component and JS references after a source move', t => {
  const result = auditWechatPackage(fixture(t, { 'pages/home/index.js': 'require("../../missing.js")' }))
  assert(result.problems.some(problem => problem.startsWith('Missing JS dependency:')))
})
test('rejects main-to-subpackage and cross-subpackage static imports', t => {
  const result = auditWechatPackage(fixture(t, { 'pages/home/index.js': 'require("../../packages/ops/config/governance.js")' }))
  assert(result.problems.some(problem => problem.startsWith('Invalid static subpackage dependency:')))
  const cross = auditWechatPackage(fixture(t, {
    'app.json': JSON.stringify({ pages: ['pages/home/index'], subPackages: [{ root: 'packages/ops', pages: ['pages/index'] }, { root: 'packages/admin', pages: ['pages/index'] }] }),
    'packages/admin/pages/index.js': 'require("../../ops/config/governance.js")',
  }))
  assert(cross.problems.some(problem => problem.startsWith('Invalid static subpackage dependency: packages/admin/')))
})
