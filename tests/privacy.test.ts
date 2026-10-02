import { test, assert } from "vitest";
import { DlpEngine, PrivacyService } from "../core/privacy/index.js";

test("Privacy: DLP Engine rules and scanning", () => {
  const engine = new DlpEngine();
  
  engine.registerPolicy({
    policyId: "dlp_1",
    organizationId: "org_1",
    name: "Block SSN",
    description: "",
    action: "BLOCK",
    status: "ACTIVE",
    rules: [
      {
        ruleId: "r1",
        type: "REGEX",
        target: "SSN",
        pattern: "\\d{3}-\\d{2}-\\d{4}",
        matchThreshold: 1
      }
    ]
  });

  engine.registerPolicy({
    policyId: "dlp_2",
    organizationId: "org_1",
    name: "Redact Credit Cards",
    description: "",
    action: "REDACT",
    status: "ACTIVE",
    rules: [
      {
        ruleId: "r2",
        type: "REGEX",
        target: "CREDIT_CARD",
        pattern: "\\b(?:\\d[ -]*?){13,16}\\b",
        matchThreshold: 1
      }
    ]
  });

  // Test Block (highest priority)
  const text1 = "My SSN is 123-45-6789 and my card is 1234-5678-9012-3456";
  const result1 = engine.scanText("org_1", text1);
  
  assert.equal(result1.action, "BLOCK");
  assert.include(result1.matches, "SSN");

  // Test Redact
  const text2 = "My card is 1234 5678 9012 3456 here.";
  const result2 = engine.scanText("org_1", text2);
  
  assert.equal(result2.action, "REDACT");
  assert.include(result2.matches, "CREDIT_CARD");
});

test("Privacy: GDPR/CCPA Privacy Requests and Retention", () => {
  const service = new PrivacyService();

  const req = service.submitPrivacyRequest("org_1", "test@example.com", "DATA_DELETION" as any);
  assert.equal(req.status, "PENDING");
  
  service.processRequest(req.requestId, "PROCESSING");
  assert.equal(service.getRequests("org_1")[0].status, "PROCESSING");

  service.processRequest(req.requestId, "COMPLETED");
  assert.equal(service.getRequests("org_1")[0].status, "COMPLETED");
  assert.isDefined(service.getRequests("org_1")[0].completedAt);

  service.setRetentionPolicy({
    policyId: "ret_1",
    organizationId: "org_1",
    dataType: "CHAT_HISTORY",
    retentionDays: 30,
    enforceDeletion: true
  });

  const policies = service.getRetentionPolicies("org_1");
  assert.equal(policies.length, 1);
  assert.equal(policies[0].retentionDays, 30);
});
