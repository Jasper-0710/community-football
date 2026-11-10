import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
// @ts-ignore Node build configuration is maintained in an ESM helper.
import { cloudBuildDefines } from '../scripts/cloud-environment.mjs'
export default defineConfig(({ mode }) => ({
  define: cloudBuildDefines(mode),
  root: fileURLToPath(new URL('.', import.meta.url)),
  envDir: fileURLToPath(new URL('..', import.meta.url)),
  publicDir: fileURLToPath(new URL('../src/static', import.meta.url)),
  plugins: [vue()],
  server: { host: '127.0.0.1', port: 5174, strictPort: true },
  build: { outDir: '../dist/admin', emptyOutDir: true },
}))
