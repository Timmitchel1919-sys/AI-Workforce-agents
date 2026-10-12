#!/usr/bin/env node
/**
 * Dependency License Scanner (Step 13).
 * Audits dependency licenses for compliance and identifies unapproved licenses.
 */
import fs from "node:fs";
import path from "node:path";

console.log("📜 Auditing dependency licenses...");

const lockPath = path.resolve(process.cwd(), "package-lock.json");
if (!fs.existsSync(lockPath)) {
  console.error("❌ package-lock.json missing.");
  process.exit(1);
}

const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
const FORBIDDEN_LICENSES = ["AGPL-1.0", "AGPL-3.0", "GPL-1.0", "GPL-2.0", "GPL-3.0", "SSPL-1.0"];
const findings = [];

if (lock.packages) {
  for (const [nodePath, info] of Object.entries(lock.packages)) {
    if (!nodePath || nodePath === "") continue;
    const pkgName = nodePath.replace(/^node_modules\//, "");
    const lic = typeof info.license === "string" ? info.license : info.license?.type || "UNKNOWN";

    if (FORBIDDEN_LICENSES.some((f) => lic.toUpperCase().includes(f))) {
      findings.push({
        id: `LIC-${pkgName}`,
        checkType: "license_scan",
        severity: "high",
        title: `Restricted license detected: ${pkgName} (${lic})`,
        description: `Dependency '${pkgName}' uses restricted license '${lic}'.`,
        packageName: pkgName,
        blocking: true,
        detectedAt: new Date().toISOString(),
      });
    }
  }
}

console.log(`📊 License Audit Results: ${findings.length} license policy violations detected.`);

if (process.argv.includes("--fail-on-blocking") && findings.length > 0) {
  console.error("❌ License scan failed: Restricted dependency licenses detected.");
  process.exit(1);
}

console.log("✅ License scan completed cleanly.");
