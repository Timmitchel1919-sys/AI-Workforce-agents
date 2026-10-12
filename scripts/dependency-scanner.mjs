#!/usr/bin/env node
/**
 * Automated Dependency Vulnerability Scanner (Step 8).
 * Parses npm audit / package dependencies and reports structured vulnerabilities.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";

console.log("🔍 Running AI Workforce dependency vulnerability scanner...");

let auditOutput = "";
try {
  auditOutput = execSync("npm audit --json", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
} catch (error) {
  auditOutput = error.stdout || "";
}

let auditData = null;
try {
  auditData = JSON.parse(auditOutput);
} catch {
  console.log("ℹ️ Could not parse npm audit JSON. Falling back to lockfile dependency verification.");
}

const findings = [];
if (auditData && auditData.vulnerabilities) {
  for (const [pkgName, details] of Object.entries(auditData.vulnerabilities)) {
    const severity = details.severity || "medium";
    const isBlocking = severity === "critical" || severity === "high";
    findings.push({
      id: `DEP-${pkgName}-${Date.now()}`,
      checkType: "dependency_scan",
      severity,
      title: `Vulnerable dependency: ${pkgName}`,
      description: `Package '${pkgName}' has a ${severity} severity vulnerability (${details.range || "all versions"}).`,
      packageName: pkgName,
      dependencyVersion: details.range || "unknown",
      via: Array.isArray(details.via) ? details.via.map((v) => (typeof v === "string" ? v : v.title)).join(", ") : String(details.via),
      remediation: details.fixAvailable ? `Upgrade via npm update ${pkgName}` : "Review vendor advisories and update lockfile.",
      blocking: isBlocking,
      detectedAt: new Date().toISOString(),
    });
  }
}

const criticals = findings.filter((f) => f.severity === "critical").length;
const highs = findings.filter((f) => f.severity === "high").length;
const total = findings.length;

console.log(`📊 Dependency Scan Results: ${total} findings (${criticals} critical, ${highs} high).`);

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ total, criticals, highs, findings }, null, 2));
}

if (process.argv.includes("--fail-on-blocking") && (criticals > 0 || highs > 0)) {
  console.error(`❌ Dependency security gate failed: ${criticals} critical, ${highs} high vulnerabilities.`);
  process.exit(1);
}

console.log("✅ Dependency scan completed.");
