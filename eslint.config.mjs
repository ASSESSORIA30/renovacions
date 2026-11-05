import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  { ignores: [".next/**", "node_modules/**", "demo/**", "next-env.d.ts", "tests/energy/fixtures/**", "e2e/*.cjs"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // El codi existent fa servir <img> per al logotip en data URL (no optimitzable amb next/image).
      "@next/next/no-img-element": "off",
      // Els textos en català porten apòstrofs: React els renderitza correctament; no és un error.
      "react/no-unescaped-entities": "off",
    },
  },
];
export default config;
