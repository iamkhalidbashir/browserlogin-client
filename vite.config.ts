import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  root: "src/mainview",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "electrobun/view": fileURLToPath(
        new URL("./.hutch/devkit/api/browser/index.ts", import.meta.url),
      ),
    },
  },
  build: {
    outDir: "../../dist/mainview",
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          query: ["@tanstack/react-query", "zustand"],
        },
      },
    },
  },
});
