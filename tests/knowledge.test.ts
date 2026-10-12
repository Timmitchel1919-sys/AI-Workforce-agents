import assert from "node:assert/strict";
import test from "node:test";

import {
  AuditLog,
  InMemoryRepository,
  type AuditEvent,
  type OperatorPrincipal,
} from "../core/index.js";
import { KnowledgeControlService } from "../control/index.js";
import type { KnowledgeItem } from "../contracts/knowledge.js";
import { PermissionDeniedError, ValidationError } from "../contracts/index.js";

/* ------------------------------------------------------------------ */
/* Harness                                                            */
/* ------------------------------------------------------------------ */

const ADMIN: OperatorPrincipal = {
  id: "op-admin",
  role: "admin",
  allowedProjects: "*",
};
const OPERATOR: OperatorPrincipal = {
  id: "op-operator",
  role: "operator",
  allowedProjects: "*",
};
const SCOPED: OperatorPrincipal = {
  id: "op-scoped",
  role: "admin",
  allowedProjects: ["money-mind"],
};

function makeService() {
  const items = new InMemoryRepository<KnowledgeItem>();
  const auditRepository = new InMemoryRepository<AuditEvent>();
  const audit = new AuditLog(undefined, auditRepository);
  return {
    service: new KnowledgeControlService(items, audit),
    auditRepository,
  };
}

/* ------------------------------------------------------------------ */
/* create / read                                                      */
/* ------------------------------------------------------------------ */

test("knowledge: an admin can create and read an item, and it is audited", () => {
  const { service, auditRepository } = makeService();
  const item = service.create(ADMIN, {
    projectId: "money-mind",
    type: "architecture",
    title: "Control Plane layers",
    body: "Presentation -> Control Plane -> domain services.",
    tags: ["architecture", " control-plane "],
  });

  assert.ok(item.id);
  assert.equal(item.knowledgeId, item.id);
  assert.equal(item.type, "architecture");
  assert.deepEqual(item.tags, ["architecture", "control-plane"]);
  assert.equal(item.createdBy, "op-admin");

  assert.deepEqual(service.get(ADMIN, item.id), item);
  assert.equal(service.list(ADMIN).length, 1);

  const events = auditRepository.list();
  assert.equal(events.length, 1);
  assert.equal(events[0]!.type, "knowledge_created");
  assert.equal(events[0]!.projectId, "money-mind");
  assert.equal(events[0]!.data?.knowledgeId, item.id);
});

test("knowledge: create rejects an unknown type and an empty title", () => {
  const { service } = makeService();
  assert.throws(
    () =>
      service.create(ADMIN, {
        type: "not-a-type" as never,
        title: "x",
        body: "y",
      }),
    ValidationError,
  );
  assert.throws(
    () => service.create(ADMIN, { type: "note", title: "  ", body: "y" }),
    ValidationError,
  );
});

/* ------------------------------------------------------------------ */
/* authorization                                                      */
/* ------------------------------------------------------------------ */

test("knowledge: writes require the administrator role", () => {
  const { service } = makeService();
  assert.throws(
    () => service.create(OPERATOR, { type: "note", title: "x", body: "y" }),
    PermissionDeniedError,
  );
});

test("knowledge: a scoped admin cannot read another project's item", () => {
  const items = new InMemoryRepository<KnowledgeItem>();
  const audit = new AuditLog(undefined, new InMemoryRepository<AuditEvent>());
  const service = new KnowledgeControlService(items, audit);
  const item = service.create(ADMIN, {
    projectId: "aims",
    type: "note",
    title: "AIMS only",
    body: "secret",
  });
  assert.equal(service.get(SCOPED, item.id), undefined);
  assert.deepEqual(service.list(SCOPED), []);
});

/* ------------------------------------------------------------------ */
/* update / search                                                    */
/* ------------------------------------------------------------------ */

test("knowledge: update changes fields, stamps updatedAt and audits", () => {
  const { service, auditRepository } = makeService();
  const item = service.create(ADMIN, {
    type: "note",
    title: "First",
    body: "body",
  });
  const updated = service.update(ADMIN, item.id, {
    title: "Second",
    tags: ["updated"],
  });
  assert.equal(updated.title, "Second");
  assert.deepEqual(updated.tags, ["updated"]);
  assert.equal(updated.type, "note");
  assert.equal(updated.id, item.id);

  const events = auditRepository.list();
  assert.equal(events.length, 2);
  assert.equal(events.at(-1)!.type, "knowledge_updated");
});

test("knowledge: list filters by type and case-insensitive search", () => {
  const { service } = makeService();
  service.create(ADMIN, {
    projectId: "money-mind",
    type: "decision",
    title: "Use Postgres",
    body: "For persistence.",
  });
  service.create(ADMIN, {
    projectId: "money-mind",
    type: "requirement",
    title: "Multi-tenant",
    body: "Projects are isolated.",
  });

  assert.equal(service.list(ADMIN, { type: "decision" }).length, 1);
  assert.equal(service.list(ADMIN, { search: "POSTGRES" }).length, 1);
  assert.equal(service.list(ADMIN, { search: "isolated" }).length, 1);
  assert.equal(service.list(ADMIN, { search: "nomatch" }).length, 0);
});
