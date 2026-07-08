/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: "#0b0d0c",
          raised: "#131615",
          panel: "#181b1a",
          border: "#262b29",
        },
        accent: {
          DEFAULT: "#adff2f",
          dim: "#8fd424",
          muted: "#4a5e1c",
        },
        status: {
          confirmed: "#4ade80",
          review: "#facc15",
          missing: "#f87171",
          idle: "#6b7280",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
    },
  },
  plugins: [],
};
