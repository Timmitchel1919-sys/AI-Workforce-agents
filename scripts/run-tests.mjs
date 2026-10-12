#!/usr/bin/env node
/**
 * Cross-version test discovery and runner.
 *
 * Node's `--test` flag accepts files, directories (recursively since 20.11),
 * and `--test` with no arguments (recursive discovery from cwd). The exact
 * supported syntax has shifted across 20.x / 22.x / 24.x, so a package.json
 * script that works on one minor can fail on another. This runner walks
 * dist/tests/ ourselves and spawns `node --test <file>…`, which every
 * version supports identically.
 */
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";

function collect(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) collect(path, out);
    else if (entry.isFile() && entry.name.endsWith(".test.js")) out.push(path);
  }
  return out;
}

const files = collect("dist/tests");
if (files.length === 0) {
  console.error(
    "No compiled tests found under dist/tests. Did `npm run build` run?",
  );
  process.exit(1);
}

console.log(`Running ${files.length} test files…`);

const child = spawn(
  process.execPath,
  [
    "--test",
    "--test-reporter=spec",
    ...files.map((f) => relative(process.cwd(), f)),
  ],
  { stdio: "inherit" },
);
child.on("exit", (code) => process.exit(code ?? 1));
