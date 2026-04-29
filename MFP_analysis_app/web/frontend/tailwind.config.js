/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Neutral gray ramp used for text, borders and muted surfaces.
        // Values are supplied as CSS custom properties so the active theme
        // (`[data-theme="day|night|night-vision"]`) can remap the entire
        // ramp at runtime. See `styles.css` for the per-theme definitions.
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
        // Primary brand ramp. `brand-500` is the canonical #5573B9 in the
        // light theme. Dark themes remap 400/500/600 to values that keep
        // buttons and active states readable on darker surfaces.
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
      },
      fontFamily: {
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "SF Pro Text",
          "Segoe UI",
          "Helvetica Neue",
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
        card: "0 1px 2px rgba(1, 14, 34, 0.04), 0 2px 4px rgba(1, 14, 34, 0.06)",
        sm: "0 1px 2px rgba(1, 14, 34, 0.06)",
        md: "0 4px 12px rgba(1, 14, 34, 0.10), 0 1px 3px rgba(1, 14, 34, 0.06)",
        lg: "0 8px 24px rgba(1, 14, 34, 0.14), 0 2px 6px rgba(1, 14, 34, 0.08)",
      },
      backgroundOpacity: {
        8: "0.08",
      },
    },
  },
  plugins: [],
};
