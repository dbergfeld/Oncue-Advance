/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: Object.fromEntries(["bg","raised","panel","line","ink","dim","accent","block","warn","info","ok"].map((k) => [k, `rgb(var(--${k}) / <alpha-value>)`])),
    },
  },
  plugins: [],
};
