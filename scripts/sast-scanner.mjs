#!/usr/bin/env node
/**
 * Static Application Security Testing (SAST) Scanner (Step 8).
 * Scans TypeScript/JavaScript source code for dangerous security antipatterns.
 */
import fs from "node:fs";
import path from "node:path";

const SAST_RULES = [
  {
    id: "SAST-001",
    severity: "critical",
    title: "Dangerous eval() usage",
    pattern: /\beval\s*\(/g,
    description: "eval() allows arbitrary code execution and is strictly forbidden.",
  },
  {
    id: "SAST-002",
    severity: "critical",
    title: "Dynamic Function constructor execution",
    pattern: /new\s+Function\s*\(/g,
    description: "new Function() creates dynamic code execution boundaries similar to eval().",
  },
  {
    id: "SAST-003",
    severity: "high",
    title: "Shell execution via child_process.exec",
    pattern: /child_process\s*\.\s*exec\s*\(/g,
    description: "child_process.exec invokes a shell and is vulnerable to command injection.",
  },
  {
    id: "SAST-004",
    severity: "high",
    title: "Deprecated/Weak crypto algorithm",
    pattern: /createCipher\s*\(|createHash\s*\(\s*['"]md5['"]\)/g,
    description: "Weak cryptographic algorithms (MD5, createCipher) should be upgraded to AES-GCM / SHA-256.",
  },
  {
    id: "SAST-005",
    severity: "medium",
    title: "Potential Unsafe Path Join / Path Traversal",
    pattern: /fs\.(readFileSync|writeFileSync|unlinkSync)\s*\([^)]*\+[^)]*\)/g,
    description: "String concatenation in filesystem operations can lead to path traversal vulnerabilities.",
  },
];

const SCAN_DIRS = ["core", "control", "api", "adapters", "contracts", "ui/src", "functions"];
const IGNORE_DIRS = ["node_modules", "dist", ".git", "coverage"];

console.log("🔍 Running AI Workforce SAST security scan...");

const findings = [];
let filesScanned = 0;

function scanDir(dirPath) {
  if (!fs.existsSync(dirPath)) return;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.includes(entry.name)) {
        scanDir(fullPath);
      }
    } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx") || entry.name.endsWith(".js") || entry.name.endsWith(".mjs"))) {
      filesScanned++;
      const content = fs.readFileSync(fullPath, "utf8");
      const lines = content.split("\n");

      for (const rule of SAST_RULES) {
        let match;
        // Reset regex
        rule.pattern.lastIndex = 0;
        while ((match = rule.pattern.exec(content)) !== null) {
          const lineNum = content.substring(0, match.index).split("\n").length;
          const lineContent = lines[lineNum - 1]?.trim() || "";

          // Skip comments or scanner's own definitions
          if (lineContent.startsWith("//") || lineContent.startsWith("*") || fullPath.includes("sast-scanner.mjs")) {
            continue;
          }

          findings.push({
            id: `${rule.id}-${filesScanned}-${lineNum}`,
            checkType: "sast",
            severity: rule.severity,
            title: rule.title,
            description: rule.description,
            filePath: fullPath.replace(/\\/g, "/"),
            ruleId: rule.id,
            remediation: "Refactor code to avoid unsafe dynamic execution, shell invocations, or weak crypto.",
            blocking: rule.severity === "critical" || rule.severity === "high",
            detectedAt: new Date().toISOString(),
          });
        }
      }
    }
  }
}

for (const dir of SCAN_DIRS) {
  scanDir(path.resolve(process.cwd(), dir));
}

const criticals = findings.filter((f) => f.severity === "critical").length;
const highs = findings.filter((f) => f.severity === "high").length;

console.log(`📊 SAST Scan Results: Scanned ${filesScanned} files. Found ${findings.length} issues (${criticals} critical, ${highs} high).`);

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ filesScanned, findings }, null, 2));
}

if (process.argv.includes("--fail-on-blocking") && (criticals > 0 || highs > 0)) {
  console.error("❌ SAST gate failed: Critical or High SAST findings detected.");
  process.exit(1);
}

console.log("✅ SAST scan completed cleanly.");
