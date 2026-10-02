import test from "node:test";

import { assert } from "./helpers/assert.js";
import { ApiKeyService, WebhookService } from "../core/developer/index.js";

test("API Platform: Key Generation and Validation", () => {
  const service = new ApiKeyService();
  
  const { rawKey, keyRecord } = service.generateKey("org_1", "Test Key", ["read:data", "write:data"]);
  
  assert.isDefined(rawKey);
  assert.equal(keyRecord.organizationId, "org_1");
  assert.equal(keyRecord.status, "ACTIVE");

  // Valid key and scope
  assert.isTrue(service.validateKey(rawKey, "read:data"));
  
  // Valid key, missing scope
  assert.isFalse(service.validateKey(rawKey, "admin:full"));

  // Invalid key string
  assert.isFalse(service.validateKey("sk_live_12345678.wrongsecret"));

  // Revoke
  service.revokeKey(keyRecord.keyId);
  assert.isFalse(service.validateKey(rawKey));
});

test("API Platform: Webhook Signatures and Delivery Tracking", async () => {
  const service = new WebhookService();
  
  const endpoint = service.createEndpoint("org_1", "https://api.example.com/webhook", "Test Hook", ["user.created"]);
  
  assert.equal(endpoint.status, "ACTIVE");
  assert.isDefined(endpoint.secret);
  assert.isTrue(endpoint.secret.startsWith("whsec_"));

  const payload = JSON.stringify({ id: "usr_1" });
  const sig = service.generateSignature(payload, endpoint.secret);
  
  assert.isTrue(sig.startsWith("v1,"));
  
  // Test simulated dispatch
  await service.dispatchEvent("org_1", "evt_1", "user.created", { id: "usr_1" });
  
  const deliveries = service.getDeliveries(endpoint.endpointId);
  assert.equal(deliveries.length, 1);
  assert.isDefined(deliveries[0].statusCode);
});
