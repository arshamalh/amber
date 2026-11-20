// Dev server for recording the demo: Amber's real UI + demo/backend.ts.
// Run from the repo root: npx vite --config demo/vite.config.ts
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath } from "node:url";
import { demoBackend } from "./backend";

export default defineConfig({
  root: fileURLToPath(new URL("..", import.meta.url)),
  plugins: [svelte(), demoBackend()],
  server: { port: 1488, strictPort: true, watch: { ignored: ["**/src-tauri/**", "**/demo/vault/**"] } },
});
