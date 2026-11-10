import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'
// @ts-ignore Node build configuration is maintained in an ESM helper.
import { cloudBuildDefines } from './scripts/cloud-environment.mjs'
export default defineConfig(({ mode }) => ({ plugins: [uni()], define: cloudBuildDefines(mode), server: { host: '127.0.0.1', port: 5173, strictPort: true } }))
