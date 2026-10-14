import { execSync } from "node:child_process";

console.log("=== Running Complete Local Security Suite (Layers 7 & 8) ===");

const scripts = [
  { name: "Secret Scan", cmd: "node scripts/security-secrets.mjs" },
  {
    name: "Dependency Audit & Exception Check",
    cmd: "node scripts/security-deps.mjs",
  },
  { name: "SBOM Generation", cmd: "node scripts/security-sbom.mjs" },
  { name: "License Inventory Check", cmd: "node scripts/security-license.mjs" },
];

for (const script of scripts) {
  console.log(`\n--- [Step] ${script.name} ---`);
  try {
    execSync(script.cmd, { stdio: "inherit" });
  } catch (error) {
    console.error(
      `\n[FAIL] Step '${script.name}' failed with exit code ${error.status}`,
    );
    process.exit(error.status || 1);
  }
}

console.log("\n=== [PASS] All local security checks passed successfully! ===");
