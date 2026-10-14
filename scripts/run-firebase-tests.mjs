import { spawn } from "node:child_process";
import { join } from "node:path";
const files = [
  "firebase-adapters.test.js",
  "firebase-function-adapter.test.js",
  "firestore-append-only-security-events.test.js",
  "onboarding-firestore-store.test.js",
  "operator-profile.test.js",
];
const env = {
  ...process.env,
  NODE_ENV: "test",
  GCLOUD_PROJECT: "demo-ai-workforce",
  FIREBASE_PROJECT_ID: "demo-ai-workforce",
  FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
  FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
  FIREBASE_STORAGE_EMULATOR_HOST: "127.0.0.1:9199",
};
if (
  env.GCLOUD_PROJECT !== "demo-ai-workforce" ||
  env.FIREBASE_PROJECT_ID !== "demo-ai-workforce" ||
  !env.FIRESTORE_EMULATOR_HOST ||
  !env.FIREBASE_AUTH_EMULATOR_HOST ||
  !env.FIREBASE_STORAGE_EMULATOR_HOST
) {
  throw new Error("Firebase integration tests require the emulator");
}
const child = spawn(
  process.execPath,
  ["--test", ...files.map((file) => join("dist", "tests", file))],
  { stdio: "inherit", env },
);
child.on("exit", (code) => process.exit(code ?? 1));
