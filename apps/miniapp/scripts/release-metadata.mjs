import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const repository = fileURLToPath(new URL('../../..', import.meta.url))
export const releaseInputs = ['apps/miniapp', 'packages/shared', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'package.json', 'scripts/release-miniapp.mjs']
export function git(...args) {
  return execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim()
}
export function createReleaseMetadata({ dataMode, apiBase, now = new Date() }) {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const manifest = readFileSync(new URL('../src/manifest.json', import.meta.url), 'utf8')
  const version = pkg.version
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('小程序版本必须使用三段数字')
  if (manifest.match(/"versionName"\s*:\s*"([^"]+)"/)?.[1] !== version) throw new Error('package.json 与 manifest.json 的版本不一致')
  return {
    version,
    commit: git('rev-parse', 'HEAD'),
    builtAt: now.toISOString(),
    dataMode: dataMode === 'remote' ? 'remote' : 'mock',
    apiBase: apiBase.replace(/\/$/, ''),
    dirty: Boolean(git('status', '--porcelain', '--', ...releaseInputs)),
  }
}
