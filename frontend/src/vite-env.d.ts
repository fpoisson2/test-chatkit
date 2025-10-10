/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CHATKIT_API_URL?: string;
  readonly VITE_CHATKIT_DOMAIN_KEY?: string;
  readonly VITE_CHATKIT_UPLOAD_STRATEGY?: string;
  readonly VITE_CHATKIT_DIRECT_UPLOAD_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
