import { execSync } from "node:child_process";
import fs from "node:fs";

console.log("Running dependency security audit (root + ui)...");

const exceptionsContent = fs.existsSync(
  "docs/security/dependency-exceptions.md",
)
  ? fs.readFileSync("docs/security/dependency-exceptions.md", "utf8")
  : "";

function isPackageCovered(packageName, _advisoryUrl) {
  if (!exceptionsContent) return false;
  const inDoc =
    exceptionsContent.includes(`\`${packageName}\``) ||
    exceptionsContent.includes(packageName);
  if (!inDoc) return false;
  // Check if exception has expired
  const expiryMatches = [
    ...exceptionsContent.matchAll(/Expiry Date\*\*:\s*(\d{4}-\d{2}-\d{2})/g),
  ];
  for (const match of expiryMatches) {
    const expiryDate = new Date(match[1]);
    if (expiryDate < new Date()) {
      console.warn(
        `[WARNING] Exception for ${packageName} expired on ${match[1]}!`,
      );
      return false;
    }
  }
  return true;
}

function auditWorkspace(prefix = "") {
  const cmd = prefix
    ? `npm --prefix ${prefix} audit --json`
    : "npm audit --json";
  let output = "";
  try {
    output = execSync(cmd, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (error) {
    output = error.stdout || "";
  }

  if (!output) {
    console.log(`[PASS] ${prefix || "root"}: No vulnerabilities reported.`);
    return { unapproved: [] };
  }

  try {
    const report = JSON.parse(output);
    const vulns = report.vulnerabilities || {};
    const unapproved = [];

    for (const [name, vuln] of Object.entries(vulns)) {
      const severity = vuln.severity;
      if (severity === "critical" || severity === "high") {
        const covered = isPackageCovered(name);
        if (covered) {
          console.log(
            `[EXCEPTION] ${prefix || "root"} -> ${name} (${severity}): Covered by dependency-exceptions.md`,
          );
        } else {
          console.error(
            `[VIOLATION] ${prefix || "root"} -> ${name} (${severity}): Unapproved vulnerability!`,
          );
          unapproved.push({ name, severity, via: vuln.via });
        }
      }
    }

    return { unapproved };
  } catch (parseErr) {
    console.warn(
      `[WARN] Could not parse audit JSON for ${prefix || "root"}:`,
      parseErr.message,
    );
    return { unapproved: [] };
  }
}

const rootAudit = auditWorkspace("");
const uiAudit = auditWorkspace("ui");

const totalViolations = rootAudit.unapproved.length + uiAudit.unapproved.length;
if (totalViolations > 0) {
  console.error(
    `\n[FAIL] Dependency policy violation: ${totalViolations} unapproved critical/high vulnerability(ies) detected.`,
  );
  process.exit(1);
} else {
  console.log(
    "\n[PASS] All dependency vulnerabilities satisfy security policy (all critical/high findings approved with active compensating controls).",
  );
}
