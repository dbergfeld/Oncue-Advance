// Build for publishing as a single self-contained page: React loads from cdnjs (UMD globals),
// everything else — app code and compiled CSS — is inlined by scripts/build-artifact.mjs.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react({ jsxRuntime: "classic" })],
  define: { "process.env.NODE_ENV": '"production"' },
  build: {
    outDir: "dist-artifact",
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      input: "src/main.tsx",
      external: ["react", "react-dom", "react-dom/client"],
      output: {
        format: "iife",
        entryFileNames: "app.js",
        assetFileNames: "app.[ext]",
        globals: { react: "React", "react-dom": "ReactDOM", "react-dom/client": "ReactDOM" },
        inlineDynamicImports: true,
      },
    },
  },
});
