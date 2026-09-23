import { readFileSync } from 'node:fs'
import ts from 'typescript'

type AdapterResolver = (id: string) => unknown

/** Run real page-local task modules while keeping transport/native adapters controlled. */
function executor(resolve: AdapterResolver) {
  const cache = new Map<string, { exports: Record<string, any> }>()
  function execute(file: URL, source: string) {
    const cached = cache.get(file.href)
    if (cached) return cached.exports
    const module = { exports: {} as Record<string, any> }
    cache.set(file.href, module)
    const code = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText
    const require = (id: string) => {
      if (id.startsWith('./') && !id.endsWith('.vue')) {
        const local = new URL(id.replace(/\.js$/, '') + (id.endsWith('.ts') ? '' : '.ts'), file)
        return execute(local, readFileSync(local, 'utf8'))
      }
      return resolve(id)
    }
    new Function('require', 'module', 'exports', code)(require, module, module.exports)
    return module.exports
  }
  return execute
}

/** Execute the real page script with controlled transport/native adapters. */
export function loadSfcScript(file: URL, names: string[], resolve: AdapterResolver) {
  const source = readFileSync(file, 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)?.[1]
  if (!source) throw new Error('Missing TypeScript setup script')
  return executor(resolve)(file, source + `\nexport { ${names.join(', ')} };`)
}

export function loadTaskScript(file: URL, resolve: AdapterResolver) {
  return executor(resolve)(file, readFileSync(file, 'utf8'))
}

export function deferred<T = any>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
