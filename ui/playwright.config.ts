import { defineConfig } from "@playwright/test";
import { join } from "node:path";
import { tmpdir } from "node:os";

const host = "127.0.0.1";
const viteCli = join(process.cwd(), "node_modules", "vite", "bin", "vite.js");
const viteCommand = (port: number) =>
  `"${process.execPath}" "${viteCli}" --host ${host} --port ${port} --strictPort`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.pw\.ts$/,
  // Authenticated specs require the emulator + Control Plane harness and are
  // run by playwright.authenticated.config.ts.
  testIgnore: /authenticated\.pw\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: "line",
  outputDir: join(tmpdir(), "ai-workforce-playwright"),
  use: {
    baseURL: `http://${host}:4173`,
    browserName: "chromium",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
  },
  webServer: [
    {
      command: viteCommand(4173),
      url: `http://${host}:4173`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        VITE_ALLOW_DEVELOPMENT_DEMO_AUTH: "false",
        VITE_FIREBASE_API_KEY: "",
        VITE_FIREBASE_AUTH_DOMAIN: "",
        VITE_FIREBASE_PROJECT_ID: "",
        VITE_FIREBASE_APP_ID: "",
      },
    },
    {
      command: viteCommand(4174),
      url: `http://${host}:4174`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        VITE_ALLOW_DEVELOPMENT_DEMO_AUTH: "true",
        VITE_FIREBASE_API_KEY: "",
        VITE_FIREBASE_AUTH_DOMAIN: "",
        VITE_FIREBASE_PROJECT_ID: "",
        VITE_FIREBASE_APP_ID: "",
      },
    },
  ],
});
