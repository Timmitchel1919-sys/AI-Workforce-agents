import test from "node:test";

import { assert } from "./helpers/assert.js";
import {
  SimulatedContainmentExecutor,
  ThreatEngine,
  type DurableSecurityIncident,
  type DurableSecurityEvent,
} from "../core/secops/index.js";
import { InMemoryRepository } from "../core/persistence/in-memory-repository.js";

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
    status: "ACTIVE",
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
    timestamp: new Date(now.getTime() - 10000),
  });

  engine.logEvent({
    eventId: "evt_2",
    organizationId: "org_1",
    source: "API",
    type: "API_ABUSE",
    severity: "MEDIUM",
    actor: "usr_123",
    details: {},
    timestamp: new Date(now.getTime() - 5000),
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
    timestamp: now,
  });

  const incidents = engine.getIncidents("org_1");
  assert.equal(incidents.length, 1);
  assert.equal(incidents[0].status, "OPEN");
  assert.equal(incidents[0].severity, "CRITICAL");
  assert.include(incidents[0].relatedEvents, "evt_3");
});

test("SecOps: threat detection never performs autonomous containment", () => {
  const engine = new ThreatEngine();
  engine.registerRule({
    ruleId: "rule_block",
    organizationId: "org_safe",
    name: "Abuse",
    condition: "RATE_LIMIT_EXCEEDED",
    threshold: 1,
    timeWindowSeconds: 60,
    action: "BLOCK_USER",
    status: "ACTIVE",
  });
  const originalLog = console.log;
  let logged = false;
  console.log = () => {
    logged = true;
  };
  try {
    engine.logEvent({
      eventId: "evt_safe",
      organizationId: "org_safe",
      source: "API",
      type: "API_ABUSE",
      severity: "CRITICAL",
      actor: "user_safe",
      details: {},
      timestamp: new Date(),
    });
  } finally {
    console.log = originalLog;
  }
  assert.equal(logged, false);
  assert.equal(engine.getIncidents("org_safe").length, 1);
});

test("SecOps: threat incidents survive an engine restart", () => {
  const incidents = new InMemoryRepository<DurableSecurityIncident>();
  const events = new InMemoryRepository<DurableSecurityEvent>();
  const first = new ThreatEngine(incidents, events);
  first.registerRule({
    ruleId: "r",
    organizationId: "org",
    name: "abuse",
    condition: "RATE_LIMIT_EXCEEDED",
    threshold: 1,
    timeWindowSeconds: 60,
    action: "ALERT",
    status: "ACTIVE",
  });
  first.logEvent({
    eventId: "e",
    organizationId: "org",
    source: "API",
    type: "API_ABUSE",
    severity: "HIGH",
    actor: "u",
    details: {},
    timestamp: new Date(),
  });
  const second = new ThreatEngine(incidents, events);
  assert.equal(second.getIncidents("org").length, 1);
  assert.equal(second.getEvents("org").length, 1);
});

test("SecOps: simulated containment is explicitly non-authoritative", async () => {
  const executor = new SimulatedContainmentExecutor();
  const result = await executor.execute({
    request: {
      incidentId: "unused",
      targetResourceType: "agent",
      targetResourceId: "agent-1",
    } as unknown as import("../contracts/destructive-action.js").DestructiveActionRequest,
    incident: {
      id: "inc",
      incidentId: "inc",
      organizationId: "org",
      title: "test",
      severity: "HIGH",
      status: "OPEN",
      relatedEvents: [],
      createdAt: new Date(),
    },
    principal: { id: "admin", role: "admin", allowedProjects: "*" },
  });
  assert.equal(result.simulatedOnly, true);
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
    createdAt: new Date().toISOString(),
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
    createdAt: new Date().toISOString(),
  });

  // Evaluate for org 1 (Should Deny)
  const allowed1 = await service.evaluateZeroTrustPolicy(
    "org_1",
    "zt_1",
    "ci_1",
    "user_1",
  );
  assert.equal(allowed1, false);

  // Evaluate for org 2 (Should Allow)
  const allowed2 = await service.evaluateZeroTrustPolicy(
    "org_2",
    "zt_2",
    "ci_1",
    "user_1",
  );
  assert.equal(allowed2, true);

  // Attempt to evaluate across tenants
  try {
    await service.evaluateZeroTrustPolicy("org_1", "zt_2", "ci_1", "user_1");
    assert.ok(false, "Should have thrown tenant isolation error");
  } catch (e) {
    assert.include(String(e), "Policy zt_2 not found for org org_1");
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
    createdAt: new Date().toISOString(),
  });

  const request = await service.evaluateAccessRequest({
    requestId: "req_1",
    organizationId: "org_1",
    requesterId: "user_1",
    targetResourceId: "res_1",
    justification: "Need access",
    status: "PENDING",
    requestedAt: new Date(),
  });

  assert.equal(request.status, "DENIED");
});
