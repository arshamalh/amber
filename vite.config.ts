import { defineConfig, type Plugin } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Serves PDF.js's character maps and standard fonts at /pdfjs/ (dev) and
 * copies them into the build, so PDFs that don't embed fonts still render.
 */
function pdfjsData(): Plugin {
  const dirs = ["cmaps", "standard_fonts"];
  const root = fileURLToPath(new URL("node_modules/pdfjs-dist", import.meta.url));
  return {
    name: "amber-pdfjs-data",
    configureServer(server) {
      server.middlewares.use("/pdfjs/", (req, res, next) => {
        const [dir, file] = (req.url ?? "").replace(/^\//, "").split("?")[0].split("/");
        if (!dirs.includes(dir) || !file || file.includes("..")) return next();
        try {
          res.end(readFileSync(join(root, dir, decodeURIComponent(file))));
        } catch {
          next();
        }
      });
    },
    generateBundle() {
      for (const dir of dirs) {
        for (const file of readdirSync(join(root, dir))) {
          this.emitFile({ type: "asset", fileName: `pdfjs/${dir}/${file}`, source: readFileSync(join(root, dir, file)) });
        }
      }
    },
  };
}

const host = process.env.TAURI_DEV_HOST;

// https://v2.tauri.app/start/frontend/vite/
export default defineConfig({
  plugins: [svelte(), pdfjsData()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    target: "es2022",
    // A desktop app loads from disk; one bundle is fine.
    chunkSizeWarningLimit: 2000,
    minify: !process.env.TAURI_ENV_DEBUG,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
});
