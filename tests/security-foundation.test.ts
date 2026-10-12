import assert from "node:assert/strict";
import test from "node:test";
import {
  InMemoryRepository,
  AppendOnlySecurityEventStore,
  RepositorySecurityEventStore,
  normalizeSecurityEvent,
  projectAuditEvent,
} from "../core/index.js";
import type { AuditEvent } from "../contracts/index.js";
import { SecurityControlService } from "../control/services/security-service.js";
function event(id: string, projectId = "p1") {
  return normalizeSecurityEvent({
    eventId: id,
    occurredAt: "2026-10-10T00:00:00.000Z",
    category: "authorization",
    type: "permission_decision",
    severity: "high",
    outcome: "denied",
    actor: { kind: "agent", id: "a1" },
    source: { kind: "api", id: "control-plane" },
    projectId,
    evidence: { apiKey: "sk-live-never-store", note: "safe" },
  });
}
for (const [name, makeStore] of [
  ["memory", () => new AppendOnlySecurityEventStore()],
  [
    "repository",
    () => new RepositorySecurityEventStore(new InMemoryRepository()),
  ],
] as const)
  test(`${name} security events are normalized, redacted and append-only`, () => {
    const store = makeStore();
    store.append(event("evt-1"));
    assert.equal(store.query()[0]?.evidence?.apiKey, "[REDACTED]");
    assert.throws(() => store.append(event("evt-1")), /already exists/);
    assert.equal(store.query({ projectId: "p2" }).length, 0);
  });
test("security event queries are bounded and project scoped", () => {
  const store = new AppendOnlySecurityEventStore();
  for (let i = 0; i < 120; i += 1) store.append(event(`evt-${i}`, "p1"));
  assert.equal(store.query({ limit: 500 }).length, 100);
  assert.equal(store.query({ projectId: "p2" }).length, 0);
});

test("canonical security reads enforce capability and project scope", async () => {
  const service = new SecurityControlService(
    new InMemoryRepository(),
    new InMemoryRepository(),
    new InMemoryRepository(),
    new AppendOnlySecurityEventStore(),
  );
  const viewer = {
    id: "viewer",
    role: "viewer" as const,
    allowedProjects: ["p1"],
  };
  const operator = {
    id: "operator",
    role: "operator" as const,
    allowedProjects: ["p1"],
  };
  const admin = {
    id: "admin",
    role: "admin" as const,
    allowedProjects: ["p1"],
  };
  const wildcardAdmin = {
    id: "wildcard-admin",
    role: "admin" as const,
    allowedProjects: "*" as const,
  };

  // Viewer lacks `view_security_events`.
  await assert.rejects(
    () => service.listCanonicalEvents(viewer),
    /view_security_events/,
  );

  // Operator holds `view_security_events` but is project-scoped: a query
  // WITHOUT projectId must not disclose global data.
  assert.deepEqual(await service.listCanonicalEvents(operator), []);
  // Operator querying its own allowed project returns an empty set (store is
  // empty), not a rejection — authorization passed.
  assert.deepEqual(
    await service.listCanonicalEvents(operator, { projectId: "p1" }),
    [],
  );
  // Operator querying a project outside its allow-list returns no data.
  assert.deepEqual(
    await service.listCanonicalEvents(operator, { projectId: "p2" }),
    [],
  );

  // Admin with explicit project scope: same project-scope rules apply.
  assert.deepEqual(await service.listCanonicalEvents(admin), []);
  assert.deepEqual(
    await service.listCanonicalEvents(admin, { projectId: "p2" }),
    [],
  );

  // Wildcard-scope admin may issue a global query without projectId.
  assert.deepEqual(await service.listCanonicalEvents(wildcardAdmin), []);
});

test("security capability matrix is deny-by-default per role", async () => {
  const { operatorCan } = await import("../contracts/control.js");
  const viewer = {
    id: "v",
    role: "viewer" as const,
    allowedProjects: "*" as const,
  };
  const operator = {
    id: "o",
    role: "operator" as const,
    allowedProjects: "*" as const,
  };
  const admin = {
    id: "a",
    role: "admin" as const,
    allowedProjects: "*" as const,
  };

  // VIEWER has exactly: view, view_security.
  assert.equal(operatorCan(viewer, "view"), true);
  assert.equal(operatorCan(viewer, "view_security"), true);
  for (const cap of [
    "view_security_events",
    "manage_security_policy",
    "manage_security_incidents",
    "request_destructive_action",
    "approve_destructive_action",
    "manage_secret_references",
    "manage_identity_security",
    "manage_agent_security",
    "contain_security_threat",
  ] as const) {
    assert.equal(
      operatorCan(viewer, cap),
      false,
      `viewer must NOT have ${cap}`,
    );
  }

  // OPERATOR has view_security, view_security_events, request_destructive_action.
  assert.equal(operatorCan(operator, "view_security"), true);
  assert.equal(operatorCan(operator, "view_security_events"), true);
  assert.equal(operatorCan(operator, "request_destructive_action"), true);
  for (const cap of [
    "manage_security_policy",
    "manage_security_incidents",
    "approve_destructive_action",
    "manage_secret_references",
    "manage_identity_security",
    "manage_agent_security",
    "contain_security_threat",
  ] as const) {
    assert.equal(
      operatorCan(operator, cap),
      false,
      `operator must NOT have ${cap}`,
    );
  }

  // ADMIN has every new security capability.
  for (const cap of [
    "view_security",
    "view_security_events",
    "manage_security_policy",
    "manage_security_incidents",
    "request_destructive_action",
    "approve_destructive_action",
    "manage_secret_references",
    "manage_identity_security",
    "manage_agent_security",
    "contain_security_threat",
  ] as const) {
    assert.equal(operatorCan(admin, cap), true, `admin must have ${cap}`);
  }
});

test("security policy mutation capability is not implied by read", async () => {
  // `manage_security_policy` is a Layer-2 primitive: no route in Layer 1
  // consumes it. This assertion locks the capability's exclusive scope so a
  // later layer that wires up policy mutation does not accidentally reuse
  // view_security.
  const { operatorCan } = await import("../contracts/control.js");
  const operator = {
    id: "o",
    role: "operator" as const,
    allowedProjects: "*" as const,
  };
  assert.equal(operatorCan(operator, "view_security"), true);
  assert.equal(operatorCan(operator, "manage_security_policy"), false);
});

test("security projector preserves governed audit decisions and redacts evidence", () => {
  const source = {
    id: "audit-1",
    type: "permission_decision",
    timestamp: "2026-10-10T00:00:00.000Z",
    agentId: "agent-1",
    projectId: "p1",
    data: { outcome: "denied", apiKey: "sk-live-never-store" },
  } satisfies AuditEvent;
  const projected = projectAuditEvent(source);
  assert.equal(projected?.category, "authorization");
  assert.equal(projected?.outcome, "denied");
  assert.equal(projected?.evidence?.apiKey, "[REDACTED]");
  assert.equal(
    projectAuditEvent({ ...source, type: "task_created" }),
    undefined,
  );
});
