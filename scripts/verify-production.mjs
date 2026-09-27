#!/usr/bin/env node
/**
 * Production verification stage (EO-6.1). Run AFTER a deploy (`npm run verify:production -- …`):
 *
 *   node scripts/verify-production.mjs --base https://x.web.app --base https://x.firebaseapp.com \
 *        [--expect-bundle assets/index-abc.js] [--expect-version <sha>] \
 *        [--protected /api/status --protected /api/projects] [--health-path /api/health] \
 *        [--timeout-ms 15000] [--allow-host .web.app --allow-host .firebaseapp.com]
 *
 * Exit 0 only when the verdict is "healthy". A deploy that exited 0 is DEPLOYED, not HEALTHY.
 * It sends no credentials and prints no secrets. Unknown flags, a flag without a value, or a
 * repeated single-value flag are usage errors (exit 2) — never a silently skipped check.
 */
import { verifyProduction } from "../dist/core/release/production-verifier.js";

const MULTI = new Set(["--base", "--protected", "--allow-host"]);
const SINGLE = new Set(["--expect-bundle", "--expect-version", "--health-path", "--timeout-ms"]);
const usage = (message) => {
  console.error(`verify-production: ${message}`);
  process.exit(2);
};

const opts = new Map();
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 2) {
  const flag = argv[i];
  const value = argv[i + 1];
  if (!MULTI.has(flag) && !SINGLE.has(flag)) usage(`unknown argument ${flag}`);
  if (value === undefined || value === "" || value.startsWith("--")) usage(`${flag} needs a value`);
  if (SINGLE.has(flag) && opts.has(flag)) usage(`${flag} may be given only once`);
  opts.set(flag, [...(opts.get(flag) ?? []), value]);
}
const all = (f) => opts.get(f);
const one = (f) => opts.get(f)?.[0];
if (!all("--base")) usage("at least one --base is required");
const timeout = one("--timeout-ms") === undefined ? undefined : Number(one("--timeout-ms"));
if (timeout !== undefined && !(Number.isInteger(timeout) && timeout > 0 && timeout <= 120000)) usage("--timeout-ms must be 1..120000");

const report = await verifyProduction({
  baseUrls: all("--base"),
  ...(all("--protected") ? { protectedPaths: all("--protected") } : {}),
  ...(all("--allow-host") ? { allowedHostSuffixes: all("--allow-host") } : {}),
  ...(one("--expect-bundle") ? { expectedBundle: one("--expect-bundle") } : {}),
  ...(one("--expect-version") ? { expectedVersion: one("--expect-version") } : {}),
  ...(one("--health-path") ? { healthPath: one("--health-path") } : {}),
  ...(timeout ? { timeoutMs: timeout } : {}),
});
console.log(JSON.stringify(report, null, 2));
process.exit(report.verdict === "healthy" ? 0 : 1);
