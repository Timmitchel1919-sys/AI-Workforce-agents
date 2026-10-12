#!/usr/bin/env node
/**
 * Software Bill of Materials (SBOM) Generator (Step 12).
 * Generates a CycloneDX 1.5 JSON SBOM for build artifacts and supply-chain verification.
 */
import fs from "node:fs";
import path from "node:path";

console.log("📦 Generating CycloneDX Software Bill of Materials (SBOM)...");

const pkgPath = path.resolve(process.cwd(), "package.json");
const lockPath = path.resolve(process.cwd(), "package-lock.json");

if (!fs.existsSync(pkgPath) || !fs.existsSync(lockPath)) {
  console.error("❌ package.json or package-lock.json missing.");
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));

const components = [];

if (lock.packages) {
  for (const [nodePath, info] of Object.entries(lock.packages)) {
    if (!nodePath || nodePath === "") continue; // Skip root
    const compName = nodePath.replace(/^node_modules\//, "");
    if (!compName) continue;

    components.push({
      type: "library",
      name: compName,
      version: info.version || "unknown",
      description: info.description || "",
      licenses: info.license ? [{ license: { id: typeof info.license === "string" ? info.license : info.license.type } }] : [],
      purl: `pkg:npm/${compName}@${info.version}`,
    });
  }
}

const sbom = {
  $schema: "http://cyclonedx.org/schema/bom-1.5.schema.json",
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  serialNumber: `urn:uuid:${Date.now()}-sbom-ai-workforce`,
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    tools: [{ vendor: "AI Workforce OS", name: "sbom-generator", version: "1.0.0" }],
    component: {
      type: "application",
      name: pkg.name || "ai-workforce-agents",
      version: pkg.version || "0.1.0",
      description: pkg.description || "",
    },
  },
  components,
};

const outputPath = path.resolve(process.cwd(), "dist/sbom.json");
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(sbom, null, 2), "utf8");

console.log(`✅ SBOM generated successfully: ${outputPath} (${components.length} components).`);
