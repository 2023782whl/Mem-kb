import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    css: false,
    testTimeout: 10_000,
    fileParallelism: false,
    include: ["src/**/*.test.{ts,tsx}"]
  },
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: {
          "react-vendor": ["react", "react-dom", "wouter"],
          "antd-vendor": ["antd"],
          "editor-vendor": ["@tiptap/react", "@tiptap/starter-kit", "@tiptap/markdown"],
          "markdown-vendor": ["react-markdown", "remark-gfm"]
        }
      }
    }
  }
});
