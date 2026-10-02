import test from "node:test";

import { assert } from "./helpers/assert.js";
import { CustomerService, SupportService, IncidentService } from "../core/customer/index.js";

test("Customer: Profile and Health Score", () => {
  const service = new CustomerService();
  const profile = service.createProfile("org_1", "Acme Corp");

  assert.equal(profile.organizationId, "org_1");
  assert.equal(profile.healthScore, 100);
  assert.equal(profile.lifecycleStage, "ONBOARDING");

  service.updateHealthScore(profile.customerId, 35);
  const updated = service.getProfile(profile.customerId);
  assert.equal(updated?.healthScore, 35);
  assert.equal(updated?.lifecycleStage, "AT_RISK");
});

test("Customer: Contacts", () => {
  const service = new CustomerService();
  const profile = service.createProfile("org_2", "Globex");

  service.addContact({
    customerId: profile.customerId,
    name: "John Doe",
    email: "john@globex.com",
    role: "EXECUTIVE_SPONSOR",
    isPrimary: true
  });

  const contacts = service.getContacts(profile.customerId);
  assert.equal(contacts.length, 1);
  assert.equal(contacts[0].name, "John Doe");
});

test("Customer: Support Cases", () => {
  const service = new SupportService();
  const supportCase = service.createCase("cust_1", "Cannot login", "I am getting a 401 error", "HIGH", "BUG");

  assert.equal(supportCase.status, "NEW");
  
  service.updateCaseStatus(supportCase.caseId, "OPEN");
  const updated = service.getCase(supportCase.caseId);
  assert.equal(updated?.status, "OPEN");

  service.escalateCase(supportCase.caseId, "URGENT");
  const escalated = service.getCase(supportCase.caseId);
  assert.equal(escalated?.priority, "URGENT");

  service.updateCaseStatus(supportCase.caseId, "RESOLVED");
  const resolved = service.getCase(supportCase.caseId);
  assert.equal(resolved?.status, "RESOLVED");
  assert.isDefined(resolved?.resolvedAt);
});

test("Customer: Incident Communication", () => {
  const service = new IncidentService();
  const incident = service.createIncident("Database Latency", "MAJOR", ["Database", "API"]);

  assert.equal(incident.status, "INVESTIGATING");
  assert.equal(incident.updates.length, 1);
  
  const active = service.getActiveIncidents();
  assert.equal(active.length, 1);

  service.addUpdate(incident.incidentId, "MONITORING", "A fix has been deployed.");
  const updated = service.getActiveIncidents()[0];
  assert.equal(updated.status, "MONITORING");
  assert.equal(updated.updates.length, 2);

  service.addUpdate(incident.incidentId, "RESOLVED", "System is fully operational.");
  const resolvedList = service.getActiveIncidents();
  assert.equal(resolvedList.length, 0); // No longer active
});

