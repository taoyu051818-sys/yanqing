import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
export default defineConfig({ base: '/admin/', plugins: [vue()], server: { strictPort: true, proxy: { '/api': { target: process.env.ADMIN_DEV_API || 'http://127.0.0.1:56392', changeOrigin: false } } }, build: { sourcemap: false } })
