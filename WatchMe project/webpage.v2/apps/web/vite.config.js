import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5174,
    proxy: {
      "/api": "http://127.0.0.1:3102",
      "/auth": "http://127.0.0.1:3102",
    },
  },
  build: {
    outDir: resolve(__dirname, "../../dist/web"),
    emptyOutDir: true,
  },
});
