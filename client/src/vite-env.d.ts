/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CHANNEL?: "alpha" | "beta" | "dev" | string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
