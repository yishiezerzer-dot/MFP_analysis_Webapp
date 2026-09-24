/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Neutral gray ramp — remapped per theme via CSS custom properties.
        ink: {
          50: "rgb(var(--ink-50) / <alpha-value>)",
          100: "rgb(var(--ink-100) / <alpha-value>)",
          200: "rgb(var(--ink-200) / <alpha-value>)",
          300: "rgb(var(--ink-300) / <alpha-value>)",
          400: "rgb(var(--ink-400) / <alpha-value>)",
          500: "rgb(var(--ink-500) / <alpha-value>)",
          600: "rgb(var(--ink-600) / <alpha-value>)",
          700: "rgb(var(--ink-700) / <alpha-value>)",
          800: "rgb(var(--ink-800) / <alpha-value>)",
          900: "rgb(var(--ink-900) / <alpha-value>)",
        },
        // Primary brand ramp — lighter in dark themes for readability.
        brand: {
          50: "rgb(var(--brand-50) / <alpha-value>)",
          100: "rgb(var(--brand-100) / <alpha-value>)",
          200: "rgb(var(--brand-200) / <alpha-value>)",
          300: "rgb(var(--brand-300) / <alpha-value>)",
          400: "rgb(var(--brand-400) / <alpha-value>)",
          500: "rgb(var(--brand-500) / <alpha-value>)",
          600: "rgb(var(--brand-600) / <alpha-value>)",
          700: "rgb(var(--brand-700) / <alpha-value>)",
          800: "rgb(var(--brand-800) / <alpha-value>)",
          900: "rgb(var(--brand-900) / <alpha-value>)",
        },
        // Surface / canvas semantic tokens — use these instead of bg-white
        // so surfaces automatically adapt to both themes.
        canvas:            "rgb(var(--canvas) / <alpha-value>)",
        surface:           "rgb(var(--surface) / <alpha-value>)",
        "surface-raised":  "rgb(var(--surface-raised) / <alpha-value>)",
        // Semantic status colors — remapped per theme for dark-mode readability.
        success:           "rgb(var(--success) / <alpha-value>)",
        "success-surface": "rgb(var(--success-surface) / <alpha-value>)",
        warning:           "rgb(var(--warning) / <alpha-value>)",
        "warning-surface": "rgb(var(--warning-surface) / <alpha-value>)",
        danger:            "rgb(var(--danger) / <alpha-value>)",
        "danger-surface":  "rgb(var(--danger-surface) / <alpha-value>)",
        info:              "rgb(var(--info) / <alpha-value>)",
        "info-surface":    "rgb(var(--info-surface) / <alpha-value>)",
        // Readable text on the matching *-surface, and text on filled brand buttons.
        "success-fg":      "rgb(var(--success-fg) / <alpha-value>)",
        "warning-fg":      "rgb(var(--warning-fg) / <alpha-value>)",
        "danger-fg":       "rgb(var(--danger-fg) / <alpha-value>)",
        "info-fg":         "rgb(var(--info-fg) / <alpha-value>)",
        "on-brand":        "rgb(var(--on-brand) / <alpha-value>)",
      },
      fontFamily: {
        sans: [
          "IBM Plex Sans",
          "system-ui",
          "sans-serif",
        ],
        mono: [
          "IBM Plex Mono",
          "JetBrains Mono",
          "SF Mono",
          "Menlo",
          "Monaco",
          "Consolas",
          "monospace",
        ],
      },
      boxShadow: {
        card: "0 1px 2px rgba(0, 0, 0, 0.04), 0 2px 4px rgba(0, 0, 0, 0.05)",
        sm: "0 1px 2px rgba(0, 0, 0, 0.05)",
        md: "0 4px 12px rgba(0, 0, 0, 0.08), 0 1px 3px rgba(0, 0, 0, 0.05)",
        lg: "0 8px 24px rgba(0, 0, 0, 0.12), 0 2px 6px rgba(0, 0, 0, 0.06)",
      },
      backgroundOpacity: {
        8: "0.08",
      },
    },
  },
  plugins: [],
};
