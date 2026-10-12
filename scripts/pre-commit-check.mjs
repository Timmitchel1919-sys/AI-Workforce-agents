#!/usr/bin/env node
/**
 * Lightweight Pre-Commit & Local Developer Check (Step 23).
 * Fast local checks: formatting, lockfile check, secret scan, and typecheck.
 */
import { execSync } from "node:child_process";

console.log("🚀 Running pre-commit security and quality checks...");

try {
  console.log("1/4 Checking lockfile consistency...");
  execSync("node scripts/check-lockfile.mjs", { stdio: "inherit" });

  console.log("2/4 Running fast secret scan...");
  execSync("node scripts/secret-scanner.mjs", { stdio: "inherit" });

  console.log("3/4 Running TypeScript typecheck...");
  execSync("npm run typecheck", { stdio: "inherit" });

  console.log("4/4 Running SAST scan...");
  execSync("node scripts/sast-scanner.mjs", { stdio: "inherit" });

  console.log("✅ All pre-commit checks passed cleanly!");
} catch (error) {
  console.error("❌ Pre-commit security checks failed. Please fix issues before committing.");
  process.exit(1);
}
