import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Firebase SDK in its own long-lived vendor chunk (cached independently of app code).
        manualChunks(id) {
          if (/node_modules[/\\](@firebase|firebase)[/\\]/.test(id)) {
            return "firebase";
          }
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    proxy: process.env.VITE_DEV_API_PROXY_TARGET
      ? {
          "/api": {
            target: process.env.VITE_DEV_API_PROXY_TARGET,
            changeOrigin: false,
          },
        }
      : undefined,
  },
});
