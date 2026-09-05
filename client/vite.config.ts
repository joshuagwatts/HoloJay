import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    {
      name: "spa-github-pages",
      closeBundle() {
        const index = path.resolve(root, "dist/index.html");
        if (fs.existsSync(index)) {
          fs.copyFileSync(index, path.resolve(root, "dist/404.html"));
        }
      },
    },
  ],
  resolve: {
    alias: {
      "@holojay/shared": path.resolve(root, "../shared/src/index.ts"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:3001",
    },
  },
});
