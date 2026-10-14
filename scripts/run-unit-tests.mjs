import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
const integration = new Set([
  "firebase-adapters.test.js",
  "firebase-function-adapter.test.js",
  "firestore-append-only-security-events.test.js",
  "onboarding-firestore-store.test.js",
  "operator-profile.test.js",
]);
const files = readdirSync("dist/tests", { withFileTypes: true })
  .filter(
    (entry) =>
      entry.isFile() &&
      entry.name.endsWith(".test.js") &&
      !integration.has(entry.name),
  )
  .map((entry) => `dist/tests/${entry.name}`);
const child = spawn(process.execPath, ["--test", ...files], {
  stdio: "inherit",
  env: { ...process.env, NODE_ENV: "test" },
});
child.on("exit", (code) => process.exit(code ?? 1));
