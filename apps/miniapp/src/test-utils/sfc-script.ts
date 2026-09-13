import { readFileSync } from 'node:fs'
import ts from 'typescript'

/** Execute the real page script with controlled transport/native adapters. */
export function loadSfcScript(file: URL, names: string[], resolve: (id: string) => unknown) {
  const source = readFileSync(file, 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)?.[1]
  if (!source) throw new Error('Missing TypeScript setup script')
  const code = ts.transpileModule(source + `\nexport { ${names.join(', ')} };`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const module = { exports: {} as Record<string, any> }
  new Function('require', 'module', 'exports', code)(resolve, module, module.exports)
  return module.exports
}

export function deferred<T = any>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
