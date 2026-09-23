/**
 * Generates Firebase's deployment manifest without relying on the local HTTP
 * discovery listener. This is required for reliable Firebase CLI discovery on
 * the Windows host used by this repository; the manifest remains derived from
 * the compiled Gen 2 entrypoint on every Functions deploy.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const root = dirname(scriptDirectory);
const binary = join(
  root,
  "node_modules",
  "firebase-functions",
  "lib",
  "bin",
  "firebase-functions.js",
);
const manifest = join(root, "functions.yaml");

const child = spawn(process.execPath, [binary, root], {
  env: { ...process.env, FUNCTIONS_MANIFEST_OUTPUT_PATH: manifest },
  stdio: "inherit",
});

child.once("error", (error) => {
  console.error("Unable to generate Firebase Functions manifest", {
    errorType: error.name,
  });
  process.exitCode = 1;
});

child.once("exit", (code, signal) => {
  if (code !== 0) {
    console.error("Firebase Functions manifest generation failed", {
      exitCode: code,
      signal,
    });
    process.exitCode = 1;
  }
});
