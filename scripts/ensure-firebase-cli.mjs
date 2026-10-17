/* global fetch */
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { access, chmod, mkdir, rename, rm } from "node:fs/promises";
import { pipeline as _pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const VERSION = "15.34.0";
const RELEASE_BASE = `https://github.com/firebase/firebase-tools/releases/download/v${VERSION}`;
const TARGETS = {
  win32: ["firebase-tools-win.exe", "919c874a22fabd89eef769a527e6cdcdef9a5015b7403d765ba1b4c18beea495"],
  linux: ["firebase-tools-linux", "e6e271a8050b70f92725e4349faf9a586ff12e1d4b57deb751e86211a107f644"],
  darwin: ["firebase-tools-macos", "3cb15de0eeac47ca86ae909dad433a58a81df9d7a1854727a751eda88d7dbb14"],
};

const root = dirname(dirname(fileURLToPath(import.meta.url)));

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export async function ensureFirebaseCli() {
  const target = TARGETS[process.platform];
  if (!target) throw new Error(`unsupported platform for Firebase CLI: ${process.platform}`);
  const [asset, expected] = target;
  const cacheDir = join(root, ".cache", "firebase-cli", VERSION);
  const binary = join(cacheDir, asset);
  await mkdir(cacheDir, { recursive: true });

  try {
    if ((await sha256(binary)) === expected) return binary;
  } catch {
    // Cache miss; download below.
  }

  const partial = `${binary}.partial-${process.pid}`;
  await rm(partial, { force: true });
  const response = await fetch(`${RELEASE_BASE}/${asset}`, { redirect: "follow" });
  if (!response.ok || !response.body) throw new Error(`Firebase CLI download failed: HTTP ${response.status}`);
  const hash = createHash("sha256");
  const stream = response.body;
  const output = createWriteStream(partial, { flags: "wx" });
  try {
    for await (const chunk of stream) {
      hash.update(chunk);
      if (!output.write(chunk)) await new Promise((resolve) => output.once("drain", resolve));
    }
    await new Promise((resolve, reject) => output.end((error) => (error ? reject(error) : resolve())));
    const actual = hash.digest("hex");
    if (actual !== expected) throw new Error(`Firebase CLI SHA-256 mismatch: expected ${expected}, got ${actual}`);
    await rename(partial, binary);
    if (process.platform !== "win32") await chmod(binary, 0o755);
  } catch (error) {
    output.destroy();
    await rm(partial, { force: true });
    throw error;
  }
  await access(binary);
  return binary;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(await ensureFirebaseCli());
}
