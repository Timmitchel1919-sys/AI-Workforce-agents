import test from "node:test";

import { assert } from "./helpers/assert.js";
import { ExtensionRegistry } from "../core/extensions/index.js";

test("Extensions: Publishing and Installation", () => {
  const registry = new ExtensionRegistry();
  
  const ext = registry.publishExtension({
    name: "Jira Sync",
    version: "1.0.0",
    publisher: "Acme Corp",
    description: "Sync tasks with Jira",
    capabilities: ["READ_DATA", "WRITE_DATA"],
    manifestUrl: "https://example.com/manifest.json"
  });

  assert.equal(ext.status, "PUBLISHED");
  
  const available = registry.listAvailableExtensions();
  assert.equal(available.length, 1);
  assert.equal(available[0].extensionId, ext.extensionId);

  const installation = registry.installExtension("org_1", ext.extensionId, "usr_1", ["READ_DATA"]);
  
  assert.equal(installation.status, "ACTIVE");
  assert.equal(installation.organizationId, "org_1");

  const orgInstallations = registry.listInstallations("org_1");
  assert.equal(orgInstallations.length, 1);
  
  // Uninstall
  registry.uninstallExtension(installation.installationId);
  assert.equal(registry.listInstallations("org_1").length, 0);
});
