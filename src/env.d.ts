/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_WECHAT_CLOUD_ENV_ID?: string
}
declare module '*.vue' { import type { DefineComponent } from 'vue'; const component: DefineComponent; export default component }
