import { defineConfig } from "@playwright/test";
import { join } from "node:path";
import { tmpdir } from "node:os";

const host = "127.0.0.1";

export default defineConfig({
  testDir: "./e2e",
  testMatch: /authenticated\.pw\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 30_000 },
  reporter: "line",
  outputDir: join(tmpdir(), "ai-workforce-authenticated-playwright"),
  use: {
    baseURL: `http://${host}:4175`,
    browserName: "chromium",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
  },
  webServer: {
    command: `npm run dev -- --host ${host} --port 4175 --strictPort`,
    url: `http://${host}:4175`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      VITE_ALLOW_DEVELOPMENT_DEMO_AUTH: "false",
      VITE_FIREBASE_API_KEY: "demo-api-key",
      VITE_FIREBASE_AUTH_DOMAIN: "demo-ai-workforce.firebaseapp.com",
      VITE_FIREBASE_PROJECT_ID: "demo-ai-workforce",
      VITE_FIREBASE_APP_ID: "1:123456789:web:authenticated-e2e",
      VITE_FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
      VITE_APP_CHECK_ENABLED: "false",
      VITE_DEV_API_PROXY_TARGET: "http://127.0.0.1:8787",
    },
  },
});
