import test from "node:test";
import { assert } from "./helpers/assert.js";
import { AssetService } from "../core/assets/index.js";

test("Assets: Tenant isolation prevents cross-tenant access", async () => {
  const svc = new AssetService();
  await svc.registerAsset({
    id: "a_1",
    assetId: "asset_1",
    organizationId: "org_A",
    name: "MacBook Pro 16",
    category: "HARDWARE",
    status: "IN_STOCK",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  try {
    await svc.getAsset("org_B", "asset_1");
    assert.ok(false, "Should throw tenant isolation violation");
  } catch (e) {
    assert.include(String(e), "Tenant isolation violation");
  }
});

test("Assets: Status update records lifecycle event", async () => {
  const svc = new AssetService();
  await svc.registerAsset({
    id: "a_2",
    assetId: "asset_2",
    organizationId: "org_A",
    name: "Figma License Key",
    category: "SOFTWARE",
    status: "PROCURED",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  await svc.updateAssetStatus(
    "org_A",
    "asset_2",
    "DEPLOYED",
    "admin_1",
    "Assigned to design team",
  );

  const events = await svc.getAssetLifecycle("org_A", "asset_2");
  assert.equal(events.length, 1);
  assert.equal(events[0].eventType, "STATUS_CHANGED");
  assert.equal(events[0].previousState, "PROCURED");
  assert.equal(events[0].newState, "DEPLOYED");
});
