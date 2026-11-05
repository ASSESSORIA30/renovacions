import { defineConfig, mergeConfig } from "vite";
import base from "./vite.config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * Build de PROVES (Playwright) de la demo amb «Supabase configurat» però apuntant a un domini inexistent:
 * totes les crides a /api/** les respon el test amb dades inventades. No s'utilitza mai en producció.
 */
export default mergeConfig(base, defineConfig({
  build: { outDir: path.resolve(root, "dist-e2e") },
  // dades inventades pròpies de les proves (no es toca la llavor de la demo)
  resolve: { alias: [{ find: /^\.\/seed\.json$/, replacement: path.resolve(root, "../e2e/seed.e2e.json") }] },
  define: {
    "process.env.NEXT_PUBLIC_SUPABASE_URL": JSON.stringify("https://e2e.invalid"),
    "process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY": JSON.stringify("e2e-fake-key"),
  },
}));
