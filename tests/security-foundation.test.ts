import assert from "node:assert/strict";
import test from "node:test";
import {
  InMemoryRepository,
  AppendOnlySecurityEventStore,
  RepositorySecurityEventStore,
  normalizeSecurityEvent,
} from "../core/index.js";
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

test("canonical security reads require admin and an explicit project scope", async () => {
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
  const admin = {
    id: "admin",
    role: "admin" as const,
    allowedProjects: ["p1"],
  };
  await assert.rejects(
    () => service.listCanonicalEvents(viewer),
    /Requires admin/,
  );
  assert.deepEqual(await service.listCanonicalEvents(admin), []);
  assert.deepEqual(
    await service.listCanonicalEvents(admin, { projectId: "p2" }),
    [],
  );
});
