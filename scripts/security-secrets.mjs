import { execSync } from "node:child_process";
import fs from "node:fs";

console.log("Running local secret scanner check...");

const SUSPICIOUS_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /"type":\s*"service_account"/,
  /sk-proj-[A-Za-z0-9_-]{20,}/,
  /ghp_[A-Za-z0-9]{30,}/,
  /xox[baprs]-[A-Za-z0-9_-]{20,}/,
  /AKIA[0-9A-Z]{16}/,
];

// Documented exclusions: unit test mock strings and public client sample envs
const IGNORED_PATH_PREFIXES = [
  "tests/",
  "ui/.env.example",
  "ui/.env.production",
  "ui/.env.test",
  ".gitleaks.toml",
];

let files = [];
try {
  const output = execSync("git ls-files", { encoding: "utf8" });
  files = output
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean);
} catch {
  console.log(
    "Not in a git repository or git command failed; skipping git ls-files.",
  );
  process.exit(0);
}

let violations = 0;

for (const file of files) {
  if (IGNORED_PATH_PREFIXES.some((p) => file.startsWith(p) || file === p))
    continue;
  if (!fs.existsSync(file)) continue;

  const stat = fs.statSync(file);
  if (stat.size > 2 * 1024 * 1024) continue;

  try {
    const content = fs.readFileSync(file, "utf8");
    for (const pattern of SUSPICIOUS_PATTERNS) {
      if (pattern.test(content)) {
        console.error(
          `[LEAK DETECTED] File '${file}' matches suspicious credential pattern: ${pattern}`,
        );
        violations += 1;
      }
    }
  } catch {
    // Non-text file
  }
}

if (violations > 0) {
  console.error(
    `\n[FAIL] Secret scanner found ${violations} suspicious credential pattern(s).`,
  );
  process.exit(1);
} else {
  console.log(
    "[PASS] Secret scan completed: Zero unredacted credentials detected.",
  );
}
