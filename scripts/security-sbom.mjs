import fs from "node:fs";

console.log("Generating Software Bill of Materials (SBOM)...");

if (!fs.existsSync("dist")) {
  fs.mkdirSync("dist", { recursive: true });
}

function generateSbomForWorkspace(lockfilePath, outputPath, componentName) {
  if (!fs.existsSync(lockfilePath)) {
    console.warn(`[WARN] Lockfile not found: ${lockfilePath}`);
    return;
  }

  const lockContent = JSON.parse(fs.readFileSync(lockfilePath, "utf8"));
  const packages = lockContent.packages || {};
  const components = [];

  for (const [pkgPath, pkgData] of Object.entries(packages)) {
    if (!pkgPath) continue; // Root entry
    const name = pkgData.name || pkgPath.replace(/^node_modules\//, "");
    components.push({
      type: "library",
      name,
      version: pkgData.version || "unknown",
      purl: `pkg:npm/${name}@${pkgData.version || "unknown"}`,
      license: pkgData.license || "NOASSERTION",
    });
  }

  const sbom = {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      component: {
        type: "application",
        name: componentName,
        version: lockContent.version || "0.1.0",
      },
    },
    components,
  };

  fs.writeFileSync(outputPath, JSON.stringify(sbom, null, 2), "utf8");
  console.log(
    `[PASS] Generated SBOM: ${outputPath} (${components.length} components)`,
  );
}

generateSbomForWorkspace(
  "package-lock.json",
  "dist/sbom-root.json",
  "ai-workforce-agents",
);
generateSbomForWorkspace(
  "ui/package-lock.json",
  "dist/sbom-ui.json",
  "ai-workforce-ui",
);
