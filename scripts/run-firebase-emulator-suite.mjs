/* global setTimeout */
import { spawn } from "node:child_process";
import net from "node:net";
import { ensureFirebaseCli } from "./ensure-firebase-cli.mjs";

const project = "demo-ai-workforce";
const ports = [8080, 9099, 9199];
const env = {
  ...process.env,
  GCLOUD_PROJECT: project,
  FIREBASE_PROJECT_ID: project,
  FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
  FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
  FIREBASE_STORAGE_EMULATOR_HOST: "127.0.0.1:9199",
};

const firebaseCli = await ensureFirebaseCli();
const emulator = spawn(
  firebaseCli,
  [
    "emulators:start",
    "--project",
    project,
    "--only",
    "auth,firestore,storage",
  ],
  { stdio: "inherit", env, shell: false },
);

const waitForPort = (port, timeoutMs = 120000) =>
  new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      const socket = net.createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() - started >= timeoutMs) {
          reject(new Error(`emulator readiness timeout on port ${port}`));
        } else {
          setTimeout(check, 250);
        }
      });
    };
    check();
  });

const stopEmulator = async () => {
  if (emulator.exitCode !== null) return;
  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn(
        "taskkill.exe",
        ["/PID", String(emulator.pid), "/T", "/F"],
        {
          stdio: "ignore",
        },
      );
      killer.once("exit", resolve);
      killer.once("error", resolve);
    });
  } else {
    emulator.kill("SIGTERM");
  }
};

let testCode = 1;
try {
  await Promise.all(ports.map((port) => waitForPort(port)));
  const test = spawn(process.execPath, ["scripts/run-firebase-tests.mjs"], {
    stdio: "inherit",
    env,
  });
  testCode = await new Promise((resolve, reject) => {
    test.once("error", reject);
    test.once("exit", (code, signal) => {
      if (signal) reject(new Error(`Firebase tests terminated by ${signal}`));
      else resolve(code ?? 1);
    });
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  testCode = 1;
} finally {
  await stopEmulator();
}

process.exit(testCode);
