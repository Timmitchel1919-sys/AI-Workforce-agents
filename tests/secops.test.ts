import test from "node:test";

import { assert } from "./helpers/assert.js";
import { ThreatEngine } from "../core/secops/index.js";

test("SecOps: Threat Engine detection and incident creation", () => {
  const engine = new ThreatEngine();
  
  engine.registerRule({
    ruleId: "rule_1",
    organizationId: "org_1",
    name: "API Abuse Spike",
    condition: "RATE_LIMIT_EXCEEDED",
    threshold: 3,
    timeWindowSeconds: 60,
    action: "BLOCK_USER",
    status: "ACTIVE"
  });

  const now = new Date();

  // Log 2 events (below threshold)
  engine.logEvent({
    eventId: "evt_1",
    organizationId: "org_1",
    source: "API",
    type: "API_ABUSE",
    severity: "MEDIUM",
    actor: "usr_123",
    details: {},
    timestamp: new Date(now.getTime() - 10000)
  });

  engine.logEvent({
    eventId: "evt_2",
    organizationId: "org_1",
    source: "API",
    type: "API_ABUSE",
    severity: "MEDIUM",
    actor: "usr_123",
    details: {},
    timestamp: new Date(now.getTime() - 5000)
  });

  assert.equal(engine.getIncidents("org_1").length, 0);

  // Log 3rd event (hits threshold)
  engine.logEvent({
    eventId: "evt_3",
    organizationId: "org_1",
    source: "API",
    type: "API_ABUSE",
    severity: "HIGH",
    actor: "usr_123",
    details: {},
    timestamp: now
  });

  const incidents = engine.getIncidents("org_1");
  assert.equal(incidents.length, 1);
  assert.equal(incidents[0].status, "OPEN");
  assert.equal(incidents[0].severity, "CRITICAL");
  assert.include(incidents[0].relatedEvents, "evt_3");
});

import { SecOpsService } from "../core/secops/secops-service.js";

test("SecOpsService: Zero-Trust Policy enforcement and Tenant Isolation", async () => {
  const service = new SecOpsService();
  
  service.addPolicy({
    id: "p_1",
    policyId: "zt_1",
    organizationId: "org_1",
    name: "Strict Deny",
    description: "Deny all",
    targetScope: "ALL",
    requiredConditions: [],
    action: "DENY",
    status: "ACTIVE",
    createdAt: new Date().toISOString()
  });

  service.addPolicy({
    id: "p_2",
    policyId: "zt_2",
    organizationId: "org_2",
    name: "Allow org 2",
    description: "Allow",
    targetScope: "ALL",
    requiredConditions: [],
    action: "ALLOW",
    status: "ACTIVE",
    createdAt: new Date().toISOString()
  });

  // Evaluate for org 1 (Should Deny)
  const allowed1 = await service.evaluateZeroTrustPolicy("org_1", "zt_1", "ci_1", "user_1");
  assert.equal(allowed1, false);

  // Evaluate for org 2 (Should Allow)
  const allowed2 = await service.evaluateZeroTrustPolicy("org_2", "zt_2", "ci_1", "user_1");
  assert.equal(allowed2, true);

  // Attempt to evaluate across tenants
  try {
    await service.evaluateZeroTrustPolicy("org_1", "zt_2", "ci_1", "user_1");
    assert.ok(false, "Should have thrown tenant isolation error");
  } catch (e: any) {
    assert.include(e.message, "Policy zt_2 not found for org org_1");
  }
});

test("SecOpsService: Threat intel and Access Request tenant isolation", async () => {
  const service = new SecOpsService();
  service.addPolicy({
    id: "p_1",
    policyId: "zt_1",
    organizationId: "org_1",
    name: "Strict Deny",
    description: "Deny all",
    targetScope: "ALL",
    requiredConditions: [],
    action: "DENY",
    status: "ACTIVE",
    createdAt: new Date().toISOString()
  });

  const request = await service.evaluateAccessRequest({
    requestId: "req_1",
    organizationId: "org_1",
    requesterId: "user_1",
    targetResourceId: "res_1",
    justification: "Need access",
    status: "PENDING",
    requestedAt: new Date()
  });

  assert.equal(request.status, "DENIED");
});
