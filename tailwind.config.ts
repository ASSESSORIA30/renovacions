import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}", "./demo/**/*.{ts,tsx,html}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter var", "Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      colors: {
        bg: "rgb(var(--bg) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        elevated: "rgb(var(--elevated) / <alpha-value>)",
        line: "rgb(var(--line) / <alpha-value>)",
        ink: "rgb(var(--ink) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        brand: "rgb(var(--brand) / <alpha-value>)",
        pend: "rgb(var(--pend) / <alpha-value>)",
        cont: "rgb(var(--cont) / <alpha-value>)",
        ren: "rgb(var(--ren) / <alpha-value>)",
        lost: "rgb(var(--lost) / <alpha-value>)",
        // --- Tokens del mòdul energètic (cups2). Neutres alineats amb Renovacions; accent i estats propis.
        "bg-elev": "rgb(var(--bg-elev) / <alpha-value>)",
        "surface-2": "rgb(var(--surface-2) / <alpha-value>)",
        border: "rgb(var(--border) / <alpha-value>)",
        "border-strong": "rgb(var(--border-strong) / <alpha-value>)",
        fg: "rgb(var(--fg) / <alpha-value>)",
        "fg-2": "rgb(var(--fg-2) / <alpha-value>)",
        "fg-3": "rgb(var(--fg-3) / <alpha-value>)",
        accent: "rgb(var(--accent) / <alpha-value>)",
        "accent-2": "rgb(var(--accent-2) / <alpha-value>)",
        "accent-fg": "rgb(var(--accent-fg) / <alpha-value>)",
        good: "rgb(var(--good) / <alpha-value>)",
        warning: "rgb(var(--warning) / <alpha-value>)",
        serious: "rgb(var(--serious) / <alpha-value>)",
        critical: "rgb(var(--critical) / <alpha-value>)",
      },
      borderRadius: { xl: "14px", "2xl": "18px" },
      boxShadow: {
        card: "0 1px 0 rgb(0 0 0 / 0.03), 0 1px 2px rgb(0 0 0 / 0.06)",
        lift: "0 12px 32px -8px rgb(0 0 0 / 0.25), 0 4px 8px -4px rgb(0 0 0 / 0.12)",
      },
      transitionTimingFunction: {
        out: "cubic-bezier(0.23, 1, 0.32, 1)",
        drawer: "cubic-bezier(0.32, 0.72, 0, 1)",
      },
    },
  },
  plugins: [],
} satisfies Config;
