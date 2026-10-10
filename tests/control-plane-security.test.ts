import test from "node:test";
import assert from "node:assert";
import { ControlPlaneSecurity } from "../core/control-plane-security.js";

test("ControlPlaneSecurity runs initialization without throwing", async () => {
  const layer = new ControlPlaneSecurity();
  await layer.runSecurityLayer();
  assert.ok(true);
});
