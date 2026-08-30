import { defineConfig } from 'vitest/config'

// Keep domain/mock tests independent from the uni-app SFC build plugin. The
// production bundle continues to use vite.config.ts; this config only runs
// TypeScript acceptance-harness tests in Node.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
})
