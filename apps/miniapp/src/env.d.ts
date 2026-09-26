/// <reference types="vite/client" />

declare const __APP_RELEASE__: {
  version: string;
  commit: string;
  builtAt: string;
  dataMode: 'remote' | 'mock';
  apiBase: string;
  dirty: boolean;
};

declare module '*.vue' {
  import { DefineComponent } from 'vue'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/ban-types
  const component: DefineComponent<{}, {}, any>
  export default component
}
