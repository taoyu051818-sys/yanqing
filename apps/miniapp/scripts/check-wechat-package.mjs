import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Use decimal KB (stricter than 200 KiB), leaving no ambiguity at the boundary.
export const MEDIA_LIMIT_BYTES = 200_000
const mediaPattern = /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif|apng|heic|mp3|wav|m4a|aac|ogg|flac|amr|aiff?|mp4)$/i

export function auditWechatPackage(directory, { remote = true } = {}) {
  const root = path.resolve(directory)
  const files = new Map()
  function walk(folder) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const absolute = path.join(folder, entry.name)
      if (entry.isDirectory()) walk(absolute)
      else if (entry.isFile()) files.set(path.relative(root, absolute).split(path.sep).join('/'), fs.statSync(absolute).size)
    }
  }
  walk(root)
  if (!files.has('app.json')) throw new Error('Not a built WeChat mini program: app.json is missing')
  const read = name => fs.readFileSync(path.join(root, name), 'utf8')
  const app = JSON.parse(read('app.json'))
  const subPackages = app.subPackages || app.subpackages || []
  const packageOf = name => subPackages.find(item => name.startsWith(item.root.replace(/\/$/, '') + '/'))?.root || ''
  const problems = new Set()
  const graph = new Map()
  function dependency(owner, request) {
    if (!request || /^(plugin|dynamicLib|ext):\/\//.test(request)) return null
    const target = path.posix.normalize(request.startsWith('/') ? request.slice(1) : path.posix.join(path.posix.dirname(owner), request))
    if (target.startsWith('../')) { problems.add('Dependency escapes package: ' + owner + ' → ' + request); return null }
    const candidates = /\.js$/.test(target) ? [target] : [target + '.js', target + '/index.js']
    const resolved = candidates.find(name => files.has(name))
    if (!resolved) { problems.add('Missing JS dependency: ' + owner + ' → ' + request); return null }
    const fromPackage = packageOf(owner)
    const toPackage = packageOf(resolved)
    if (toPackage && fromPackage !== toPackage) problems.add('Invalid static subpackage dependency: ' + owner + ' → ' + resolved)
    return resolved
  }
  function componentDependencies(owner, config) {
    return Object.values(config.usingComponents || {}).map(value => dependency(owner, value)).filter(Boolean)
  }
  for (const name of files.keys()) {
    if (!name.endsWith('.js')) continue
    const refs = [...read(name).matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)].map(match => dependency(name, match[1])).filter(Boolean)
    const config = name.replace(/\.js$/, '.json')
    if (files.has(config)) refs.push(...componentDependencies(name, JSON.parse(read(config))))
    graph.set(name, refs)
  }
  const mainRoots = ['app.js', ...(app.pages || []).map(name => name + '.js'), ...componentDependencies('app.js', app)]
  // Declared worker scripts are entry points rather than require() dependencies.
  if (typeof app.workers === 'string') mainRoots.push(...[...files.keys()].filter(name => name.startsWith(app.workers.replace(/\/$/, '') + '/') && name.endsWith('.js')))
  const subRoots = subPackages.flatMap(item => item.pages.map(name => item.root + '/' + name + '.js'))
  for (const name of [...mainRoots, ...subRoots]) if (!files.has(name)) problems.add('Missing page/entry JS: ' + name)
  const visited = new Set()
  function visit(name) {
    if (visited.has(name)) return
    visited.add(name)
    for (const child of graph.get(name) || []) visit(child)
  }
  mainRoots.forEach(visit)
  const unusedMainJs = [...graph.keys()].filter(name => !packageOf(name) && !visited.has(name)).sort()
  const oversizedMedia = [...files].filter(([name, bytes]) => mediaPattern.test(name) && bytes > MEDIA_LIMIT_BYTES).map(([name, bytes]) => ({ name, bytes }))
  const mockFiles = remote ? [...files.keys()].filter(name => /(^|\/)services\/mock\//.test(name)) : []
  for (const name of unusedMainJs) problems.add('Unused main-package JS: ' + name)
  for (const item of oversizedMedia) problems.add('Media exceeds 200 KB: ' + item.name + ' (' + item.bytes + ' bytes)')
  for (const name of mockFiles) problems.add('Mock module in remote package: ' + name)
  return {
    ok: problems.size === 0,
    remote,
    mainBytes: [...files].filter(([name]) => !packageOf(name)).reduce((sum, [, bytes]) => sum + bytes, 0),
    totalBytes: [...files.values()].reduce((sum, bytes) => sum + bytes, 0),
    mediaCount: [...files.keys()].filter(name => mediaPattern.test(name)).length,
    largestMedia: [...files].filter(([name]) => mediaPattern.test(name)).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, bytes]) => ({ name, bytes })),
    unusedMainJs, oversizedMedia, mockFiles, problems: [...problems],
  }
}

async function main() {
  const { loadEnv } = await import('vite')
  const miniapp = fileURLToPath(new URL('..', import.meta.url))
  const args = process.argv.slice(2)
  const directory = args.find(arg => !arg.startsWith('--')) || process.env.UNI_OUTPUT_DIR || path.join(miniapp, 'dist/build/mp-weixin')
  const mode = args.find(arg => arg.startsWith('--mode='))?.slice(7) || 'production'
  const dataMode = process.env.VITE_DATA_MODE ?? loadEnv(mode, miniapp, 'VITE_DATA_MODE').VITE_DATA_MODE
  const result = auditWechatPackage(directory, { remote: !args.includes('--allow-mock') && dataMode === 'remote' })
  console.log(JSON.stringify(result, null, 2))
  if (!result.ok) process.exitCode = 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
