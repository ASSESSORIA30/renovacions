import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));

// Builds the whole app (same components as Next.js) into ONE self-contained HTML file using the local repository.
export default defineConfig({
  root,
  plugins: [react(), viteSingleFile()],
  resolve: { alias: { "@": path.resolve(root, "../src") } },
  css: { postcss: path.resolve(root, "..") },
  build: { outDir: path.resolve(root, "dist"), emptyOutDir: true, chunkSizeWarningLimit: 10000, assetsInlineLimit: 100000000 },
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
});
