import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";

/**
 * High-confidence secret scanner script.
 * Scans repository source files for accidentally committed live API keys, private keys,
 * or credentials.
 */

const SECRET_PATTERNS = [
  { name: "Private RSA/EC/SSH Key", pattern: /-----BEGIN\s+(RSA|EC|OPENSSH|DSA)?\s*PRIVATE\s+KEY-----/ },
  { name: "Live Anthropic API Key", pattern: /sk-ant-api03-[A-Za-z0-9_\-]{30,}/ },
  { name: "Live OpenAI API Key", pattern: /sk-proj-[A-Za-z0-9_\-]{30,}/ },
  { name: "Live GitHub PAT", pattern: /ghp_[A-Za-z0-9]{36}/ },
  { name: "Google Service Account JSON", pattern: /"type":\s*"service_account"[\s\S]*?"private_key":\s*"-----BEGIN/ },
];

const SCAN_DIRS = [
  "adapters",
  "agents",
  "api",
  "contracts",
  "control",
  "core",
  "docs",
  "functions",
  "scripts",
  "sdk",
  "tests",
  "ui/src",
];

const ALLOWED_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".yml",
  ".yaml",
  ".env",
  ".rules",
]);

const IGNORE_FILES = new Set([
  "package-lock.json",
  "ui/package-lock.json",
  "tests/fixtures/fake-firestore.ts",
  "tests/anthropic-provider.test.ts",
  "tests/control-plane.test.ts",
  "tests/project-onboarding.test.ts",
  "tests/release.test.ts",
  "tests/security-center.test.ts",
]);

function scanDirectory(dir, findings = []) {
  try {
    const entries = readdirSync(dir);

    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const relPath = relative(process.cwd(), fullPath).replace(/\\/g, "/");

      if (IGNORE_FILES.has(relPath)) continue;

      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        scanDirectory(fullPath, findings);
      } else if (stat.isFile()) {
        const ext = extname(entry).toLowerCase();
        if (ALLOWED_EXTENSIONS.has(ext)) {
          scanFile(fullPath, relPath, findings);
        }
      }
    }
  } catch {
    // Ignore unreadable directories
  }

  return findings;
}

function scanFile(filePath, relPath, findings) {
  try {
    const content = readFileSync(filePath, "utf8");

    for (const { name, pattern } of SECRET_PATTERNS) {
      if (pattern.test(content)) {
        findings.push({
          file: relPath,
          type: name,
        });
      }
    }
  } catch {
    // Ignore unreadable files
  }
}

console.log("🔍 Running AI Workforce automated secret scanner...");
const findings = [];
for (const dir of SCAN_DIRS) {
  const full = join(process.cwd(), dir);
  scanDirectory(full, findings);
}

if (findings.length > 0) {
  console.error("\n❌ HIGH-CONFIDENCE SECRET FINDINGS DETECTED:");
  for (const finding of findings) {
    console.error(`  - File: ${finding.file} (Type: ${finding.type})`);
  }
  console.error("\nPlease remove these secrets, update .gitignore, and rotate compromised credentials.");
  process.exit(1);
} else {
  console.log("✅ Secret scan clean! No committed production secrets found.\n");
  process.exit(0);
}
