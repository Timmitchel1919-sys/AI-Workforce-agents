#!/usr/bin/env node
/**
 * Lockfile Integrity & Consistency Scanner (Step 6).
 * Ensures package-lock.json exists, is non-empty, and adheres to npm lockfile requirements.
 */
import fs from "node:fs";
import path from "node:path";

console.log("🔍 Checking dependency lockfile integrity...");

const lockfilePath = path.resolve(process.cwd(), "package-lock.json");

if (!fs.existsSync(lockfilePath)) {
  console.error("❌ CRITICAL: 'package-lock.json' is missing! Lockfile consistency is mandatory.");
  process.exit(1);
}

const stats = fs.statSync(lockfilePath);
if (stats.size === 0) {
  console.error("❌ CRITICAL: 'package-lock.json' is 0 bytes!");
  process.exit(1);
}

try {
  const lockfile = JSON.parse(fs.readFileSync(lockfilePath, "utf8"));
  if (!lockfile.lockfileVersion || lockfile.lockfileVersion < 2) {
    console.error(`❌ Lockfile version ${lockfile.lockfileVersion} is outdated or unsupported. Lockfile v2 or v3 required.`);
    process.exit(1);
  }
} catch (err) {
  console.error("❌ Invalid or corrupted JSON in 'package-lock.json':", err.message);
  process.exit(1);
}

console.log("✅ Lockfile consistency verified.");
