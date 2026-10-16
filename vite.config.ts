import { defineConfig } from "vite";
import { resolve } from "node:path";
export default defineConfig({
  base: "./",
  optimizeDeps: {
    include: [
      "pdf-lib",
      "@pdf-lib/fontkit",
      "pdfjs-dist/legacy/build/pdf.mjs",
      "fflate",
    ],
  },
  build: {
    rollupOptions: {
      input: {
        dashboard: resolve("src/dashboard/index.html"),
        sidepanel: resolve("src/sidepanel/index.html"),
      },
    },
  },
});
