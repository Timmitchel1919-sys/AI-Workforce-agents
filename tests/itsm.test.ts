import { test } from "node:test";
import * as assert from "node:assert";
import { ITSMControlService } from "../control/services/itsm-control-service.js";
import { Repository, Entity } from "../contracts/persistence.js";
import {
  Incident,
  ChangeRequest,
  ConfigurationItem,
  CIRelationship,
  Problem,
  Service,
  ITSMRelease,
  ServiceRequest,
  Runbook,
} from "../contracts/itsm.js";

class InMemoryRepo<T extends Entity> implements Repository<T> {
  private data = new Map<string, T>();
  upsert(entity: T): void {
    this.data.set(entity.id, { ...entity });
  }
  findById(id: string): T | undefined {
    return this.data.get(id);
  }
  list(): T[] {
    return Array.from(this.data.values());
  }
  delete(id: string): boolean {
    return this.data.delete(id);
  }
  clear(): void {
    this.data.clear();
  }
}

test("ITSMControlService - Routing Incidents", async () => {
  const service = new ITSMControlService(
    new InMemoryRepo<Service>(),
    new InMemoryRepo<Incident>(),
    new InMemoryRepo<Problem>(),
    new InMemoryRepo<ChangeRequest>(),
    new InMemoryRepo<ITSMRelease>(), // ITSMRelease
    new InMemoryRepo<ConfigurationItem>(),
    new InMemoryRepo<ServiceRequest>(), // ServiceRequest
    new InMemoryRepo<Runbook>(), // Runbook
    new InMemoryRepo<CIRelationship>(),
  );

  const incident = await service.createIncident({
    organizationId: "org-1",
    title: "DB is down",
    description: "Connection timeout",
    serviceId: "svc-db-1",
    severity: "critical",
    status: "new",
    majorIncident: false,
  });

  assert.strictEqual(incident.majorIncident, true);
  assert.strictEqual(incident.assignmentGroup, "Major Incident Team");

  const routed = await service.routeIncident("org-1", incident.id);
  assert.strictEqual(routed.assignmentGroup, "Major Incident Team");

  const dbIncident = await service.createIncident({
    organizationId: "org-1",
    title: "Slow query",
    description: "Query taking too long",
    serviceId: "svc-db-2",
    severity: "medium",
    status: "new",
    majorIncident: false,
  });

  const routedDb = await service.routeIncident("org-1", dbIncident.id);
  assert.strictEqual(routedDb.assignmentGroup, "Database Team");
});

test("ITSMControlService - Change Approvals", async () => {
  const service = new ITSMControlService(
    new InMemoryRepo<Service>(),
    new InMemoryRepo<Incident>(),
    new InMemoryRepo<Problem>(),
    new InMemoryRepo<ChangeRequest>(),
    new InMemoryRepo<ITSMRelease>(), // ITSMRelease
    new InMemoryRepo<ConfigurationItem>(),
    new InMemoryRepo<ServiceRequest>(), // ServiceRequest
    new InMemoryRepo<Runbook>(), // Runbook
    new InMemoryRepo<CIRelationship>(),
  );

  const cr = await service.createChangeRequest({
    organizationId: "org-1",
    title: "Upgrade DB",
    description: "Version upgrade",
    type: "normal",
    status: "pending_approval",
    serviceId: "svc-db-1",
    requestedBy: "user-1",
  });

  assert.strictEqual(cr.cabRequired, true);
  assert.strictEqual(cr.cabApprovalStatus, "pending");

  const approved = await service.approveChange("org-1", cr.id, "approver-1");
  assert.strictEqual(approved.cabApprovalStatus, "approved");
  assert.strictEqual(approved.approvedBy, "approver-1");
});

test("ITSMControlService - CMDB Relationships", async () => {
  const service = new ITSMControlService(
    new InMemoryRepo<Service>(),
    new InMemoryRepo<Incident>(),
    new InMemoryRepo<Problem>(),
    new InMemoryRepo<ChangeRequest>(),
    new InMemoryRepo<ITSMRelease>(), // ITSMRelease
    new InMemoryRepo<ConfigurationItem>(),
    new InMemoryRepo<ServiceRequest>(), // ServiceRequest
    new InMemoryRepo<Runbook>(), // Runbook
    new InMemoryRepo<CIRelationship>(),
  );

  const ci1 = await service.createCI({
    organizationId: "org-1",
    name: "Web Server",
    ciType: "Server",
    status: "active",
  });

  const ci2 = await service.createCI({
    organizationId: "org-1",
    name: "Database",
    ciType: "Database",
    status: "active",
  });

  await service.addCIRelationship({
    organizationId: "org-1",
    sourceCiId: ci1.id,
    targetCiId: ci2.id,
    relationshipType: "depends_on",
  });

  const deps = await service.getCIDependencies("org-1", ci1.id);
  assert.strictEqual(deps.length, 1);
  assert.strictEqual(deps[0].id, ci2.id);
});
