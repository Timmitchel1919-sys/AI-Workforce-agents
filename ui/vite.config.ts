import { loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// The dev server proxies `/api` to a locally running Control Plane HTTP API so
// the browser only ever talks to same-origin `/api/*`. Set VITE_API_PROXY_TARGET
// in `.env.local` to change the target. Production builds resolve the API base
// from VITE_API_BASE_URL at runtime instead.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "VITE_");
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: env.VITE_API_PROXY_TARGET || "http://localhost:8787",
          changeOrigin: true,
        },
      },
    },
    preview: { port: 4173 },
    build: {
      outDir: "dist",
      sourcemap: mode !== "production",
    },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./vitest.setup.ts"],
      css: false,
      restoreMocks: true,
    },
  };
});
