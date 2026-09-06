import { readFileSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// Execute actual page setup and local helpers with native hooks/network detached.
// Node normally supplies Intl, masking setup crashes on a limited JS runtime.
const sourceRoot = resolve(process.cwd(), 'src')
const pagesRoot = resolve(sourceRoot, 'packages/ops/pages')
const pages = readdirSync(pagesRoot).map(name => `packages/ops/pages/${name}/index.vue`)
pages.push('pages/workspace/index.vue')
function initializePage(path: string) {
  const context = vm.createContext({ Intl: undefined, console, uni: { getStorageSync: () => '' } })
  const vue = {
    ref: (value: unknown) => ({ value }), reactive: (value: unknown) => value,
    computed: (read: () => unknown) => ({ get value() { return read() } }),
    onUnmounted: () => {}, nextTick: () => Promise.resolve(), watch: () => {},
  }
  const session = { roles: ['MEMBER', 'SUPER_ADMIN'], user: { id: 'runtime-test' }, isOperator: true }
  const modules = new Map<string, { exports: any }>()
  function load(file: string): any {
    if (modules.has(file)) return modules.get(file)!.exports
    let source = readFileSync(file, 'utf8')
    if (file.endsWith('.vue')) source = source.match(/<script setup[^>]*>([\s\S]*?)<\/script>/)![1]
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
    const module = { exports: {} }; modules.set(file, module)
    const require = (id: string) => {
      if (id === 'vue') return vue
      if (id === '@dcloudio/uni-app') return { onLoad() {}, onShow() {}, onHide() {}, onShareAppMessage() {} }
      if (id.endsWith('.vue')) return { default: {} }
      if (id.endsWith('/stores/session')) return { useSessionStore: () => session }
      if (id.endsWith('/services/api')) return { endpoints: {} }
      if (id.endsWith('/services/http')) return { api: {}, isMockMode: false }
      if (!id.startsWith('.')) throw new Error(`Unexpected dependency ${id}`)
      return load(resolve(dirname(file), id + '.ts'))
    }
    vm.runInContext(`(function(require,module,exports){${compiled}\n})`, context, { filename: file })(require, module, module.exports)
    return module.exports
  }
  load(resolve(sourceRoot, path))
}
describe('operations page setup without Intl', () => {
  it.each(pages)('%s initializes before its first network request', path => {
    expect(() => initializePage(path)).not.toThrow()
  })
})
