import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        surface: "var(--surface)",
        "surface-hover": "var(--surface-hover)",
        "surface-active": "var(--surface-active)",
        border: "var(--border)",
        "border-strong": "var(--border-strong)",
        text: "var(--text)",
        muted: "var(--muted)",
        faint: "var(--faint)",
        success: "var(--success)",
        danger: "var(--danger)",
        warning: "var(--warning)",
        accent: "var(--accent)",
        "accent-soft": "var(--accent-soft)"
      },
      borderRadius: {
        window: "var(--radius-window)",
        card: "var(--radius-card)",
        input: "var(--radius-input)",
        pill: "var(--radius-pill)"
      },
      boxShadow: {
        window: "var(--shadow-window)",
        card: "var(--shadow-card)",
        pill: "var(--shadow-pill)"
      },
      fontFamily: {
        sans: [
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif"
        ],
        mono: ["ui-monospace", "SFMono-Regular", "Cascadia Mono", "Menlo", "monospace"]
      }
    }
  },
  plugins: []
} satisfies Config;
