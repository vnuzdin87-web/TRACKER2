import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";

export default defineConfig({
  root: "client",
  plugins: [react(), tailwind()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/health": "http://127.0.0.1:3000",
      "/api/v1": "http://127.0.0.1:3000",
    },
  },
  build: {
    outDir: "../dist/client",
    emptyOutDir: true,
    rollupOptions: { output: { manualChunks: { charts: ["recharts"] } } },
  },
});
