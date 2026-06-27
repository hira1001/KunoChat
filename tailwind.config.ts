import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: ["class"],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        "bg-glass": "var(--bg-glass)",
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
        "accent-hover": "var(--accent-hover)",
        "accent-soft": "var(--accent-soft)",
        "accent-glow": "var(--accent-glow)"
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
        pill: "var(--shadow-pill)",
        accent: "var(--shadow-accent)"
      },
      fontFamily: {
        sans: [
          "Outfit",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif"
        ],
        mono: ["ui-monospace", "SFMono-Regular", "Cascadia Mono", "Menlo", "monospace"]
      },
      transitionTimingFunction: {
        spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
        smooth: "cubic-bezier(0.4, 0, 0.2, 1)"
      }
    }
  },
  plugins: []
} satisfies Config;
