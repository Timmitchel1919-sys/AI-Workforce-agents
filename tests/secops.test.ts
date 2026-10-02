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
