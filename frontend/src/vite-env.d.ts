/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CHATKIT_API_URL?: string;
  readonly VITE_CHATKIT_DOMAIN_KEY?: string;
  readonly VITE_CHATKIT_UPLOAD_STRATEGY?: string;
  readonly VITE_CHATKIT_DIRECT_UPLOAD_URL?: string;
  readonly VITE_CHATKIT_SKIP_DOMAIN_VERIFICATION?: string;
  readonly VITE_CHATKIT_FORCE_HOSTED?: string;
  readonly VITE_CHATKIT_ALLOWED_HOSTS?: string;
  readonly VITE_BACKEND_URL?: string;
  readonly VITE_VOICE_SESSION_URL?: string;
  readonly VITE_VOICE_DEFAULT_MODEL?: string;
  readonly VITE_VOICE_DEFAULT_INSTRUCTIONS?: string;
  readonly VITE_VOICE_DEFAULT_VOICE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
