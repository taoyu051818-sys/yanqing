import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Keep domain/mock tests independent from the uni-app SFC build plugin. The
// production bundle continues to use vite.config.ts; this config only runs
// TypeScript acceptance-harness tests in Node.
export default defineConfig({
  resolve: { alias: { '@miniapp/mock': fileURLToPath(new URL('./src/services/mock', import.meta.url)) } },
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
})
