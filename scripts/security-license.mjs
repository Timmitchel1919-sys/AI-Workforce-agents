import fs from "node:fs";

console.log("Generating License Inventory...");

if (!fs.existsSync("dist")) {
  fs.mkdirSync("dist", { recursive: true });
}

const ALLOWED_LICENSES = new Set([
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "0BSD",
  "Python-2.0",
  "CC0-1.0",
  "Unlicense",
]);

const PROHIBITED_LICENSES = new Set([
  "AGPL-1.0",
  "AGPL-3.0",
  "AGPL-3.0-only",
  "AGPL-3.0-or-later",
  "SSPL-1.0",
]);

function inventoryWorkspace(lockfilePath) {
  if (!fs.existsSync(lockfilePath)) return [];
  const lock = JSON.parse(fs.readFileSync(lockfilePath, "utf8"));
  const pkgs = lock.packages || {};
  const list = [];

  for (const [pkgPath, pkg] of Object.entries(pkgs)) {
    if (!pkgPath) continue;
    const name = pkg.name || pkgPath.replace(/^node_modules\//, "");
    const license = pkg.license || "UNKNOWN";
    let status = "review_required";
    if (ALLOWED_LICENSES.has(license)) {
      status = "allowed";
    } else if (PROHIBITED_LICENSES.has(license)) {
      status = "prohibited";
    }

    list.push({
      package: name,
      version: pkg.version || "unknown",
      license,
      status,
    });
  }

  return list;
}

const rootList = inventoryWorkspace("package-lock.json");
const uiList = inventoryWorkspace("ui/package-lock.json");
const combined = [...rootList, ...uiList];

const prohibited = combined.filter((p) => p.status === "prohibited");
const inventory = {
  generatedAt: new Date().toISOString(),
  totalPackages: combined.length,
  allowedCount: combined.filter((p) => p.status === "allowed").length,
  reviewRequiredCount: combined.filter((p) => p.status === "review_required")
    .length,
  prohibitedCount: prohibited.length,
  packages: combined,
};

fs.writeFileSync(
  "dist/licenses.json",
  JSON.stringify(inventory, null, 2),
  "utf8",
);
console.log(
  `[PASS] License inventory written: dist/licenses.json (${combined.length} packages)`,
);

if (prohibited.length > 0) {
  console.error(
    `[FAIL] Found ${prohibited.length} package(s) with prohibited license(s):`,
    prohibited,
  );
  process.exit(1);
} else {
  console.log("[PASS] Zero prohibited licenses found.");
}
