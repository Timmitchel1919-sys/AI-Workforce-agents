import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        // Firebase SDK in its own long-lived vendor chunk (cached independently of app code).
        advancedChunks: {
          groups: [{ name: "firebase", test: /node_modules[/\\](@firebase|firebase)[/\\]/ }],
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: false,
  },
});