/* global setTimeout */
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import net from "node:net";
import { join } from "node:path";
import { ensureFirebaseCli } from "./ensure-firebase-cli.mjs";

const project = "demo-ai-workforce";
const host = "127.0.0.1";
const emulatorPorts = [8080, 9099, 9199];
const ownerEmail = "owner@authenticated-e2e.test";
const pendingEmail = "pending@authenticated-e2e.test";
const viewerEmail = "viewer@authenticated-e2e.test";
const password = `E2e-${randomBytes(18).toString("base64url")}!9a`;
const env = {
  ...process.env,
  GCLOUD_PROJECT: project,
  FIREBASE_PROJECT_ID: project,
  FIRESTORE_EMULATOR_HOST: `${host}:8080`,
  FIREBASE_AUTH_EMULATOR_HOST: `${host}:9099`,
  FIREBASE_STORAGE_EMULATOR_HOST: `${host}:9199`,
  APP_CHECK_MODE: "disabled",
  NODE_ENV: "test",
  AIW_E2E_OWNER_EMAIL: ownerEmail,
  AIW_E2E_PENDING_EMAIL: pendingEmail,
  AIW_E2E_VIEWER_EMAIL: viewerEmail,
  AIW_E2E_PASSWORD: password,
};

async function resolveFirebaseInvocation() {
  const explicit = process.env.AIW_FIREBASE_CLI?.trim();
  if (explicit) {
    try {
      await access(explicit);
      return { command: explicit, args: [] };
    } catch {
      // Fall through to the repository's checksum-pinned official binary.
    }
  }
  if (process.platform === "win32" && process.env.APPDATA) {
    const installedScript = join(
      process.env.APPDATA,
      "npm",
      "node_modules",
      "firebase-tools",
      "lib",
      "bin",
      "firebase.js",
    );
    try {
      await access(installedScript);
      return { command: process.execPath, args: [installedScript] };
    } catch {
      // Fall through to the repository's checksum-pinned official binary.
    }
  }
  return { command: await ensureFirebaseCli(), args: [] };
}

const firebaseInvocation = await resolveFirebaseInvocation();
const children = [];

function start(command, args, cwd = process.cwd()) {
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: "inherit",
    shell: false,
  });
  children.push(child);
  return child;
}

function waitForPort(port, timeoutMs = 180_000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      const socket = net.createConnection({ host, port });
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() - started >= timeoutMs)
          reject(new Error(`readiness timeout on port ${port}`));
        else setTimeout(check, 250);
      });
    };
    check();
  });
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn(
        "taskkill.exe",
        ["/PID", String(child.pid), "/T", "/F"],
        {
          stdio: "ignore",
        },
      );
      killer.once("exit", resolve);
      killer.once("error", resolve);
    });
  } else {
    child.kill("SIGTERM");
  }
}

let exitCode = 1;
try {
  const emulator = start(firebaseInvocation.command, [
    ...firebaseInvocation.args,
    "emulators:start",
    "--project",
    project,
    "--only",
    "auth,firestore,storage",
  ]);
  const emulatorExit = new Promise((_, reject) => {
    emulator.once("exit", (code, signal) => {
      reject(
        new Error(
          `Firebase emulators exited before readiness (${signal ?? `code ${code ?? 1}`})`,
        ),
      );
    });
  });
  await Promise.race([
    Promise.all(emulatorPorts.map((port) => waitForPort(port))),
    emulatorExit,
  ]);

  start(process.execPath, ["scripts/authenticated-e2e-control-plane.mjs"]);
  await waitForPort(8787, 120_000);

  const npmInvocation =
    process.platform === "win32" && process.env.APPDATA
      ? {
          command: process.execPath,
          args: [
            join(
              process.env.APPDATA,
              "npm",
              "node_modules",
              "npm",
              "bin",
              "npm-cli.js",
            ),
          ],
        }
      : { command: "npm", args: [] };
  const playwright = start(npmInvocation.command, [
    ...npmInvocation.args,
    "--prefix",
    "ui",
    "run",
    "test:e2e:authenticated",
  ]);
  exitCode = await new Promise((resolve, reject) => {
    playwright.once("error", reject);
    playwright.once("exit", (code, signal) => {
      if (signal)
        reject(new Error(`authenticated Playwright terminated by ${signal}`));
      else resolve(code ?? 1);
    });
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
} finally {
  for (const child of children.reverse()) await stop(child);
}

process.exit(exitCode);
