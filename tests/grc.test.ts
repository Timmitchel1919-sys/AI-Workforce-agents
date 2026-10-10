import test from "node:test";

import { assert } from "./helpers/assert.js";
import { GrcService } from "../core/grc/index.js";

test("GRC: Control definitions and instances", () => {
  const grc = new GrcService();
  const def = grc.compliance.createControlDefinition({
    controlKey: "AC-1",
    title: "Access Control Policy",
    description: "Policy for access control",
    category: "Access Control" as any,
    controlType: "PREVENTIVE",
    objective: "Ensure proper access",
    scope: "ORGANIZATION" as any,
    automationLevel: "MANUAL",
    testingMethod: "MANUAL",
    evidenceRequirements: ["policy document"],
    version: 1,
    status: "ACTIVE",
    updatedBy: "admin",
  } as any);
  
  assert.exists(def.controlId);
  assert.equal(def.controlKey, "AC-1");
  
  const inst = grc.compliance.createControlInstance({
    controlId: def.controlId,
    organizationId: "org_1",
    scopeType: "ORGANIZATION" as any,
    implementationOwner: "owner1",
    controlOwner: "owner1",
    status: "IMPLEMENTED" as any,
    effectiveness: "EFFECTIVE" as any,
    evidenceFreshness: "CURRENT" as any,
  });
  
  assert.exists(inst.instanceId);
  assert.equal(inst.status, "IMPLEMENTED");
});

test("GRC: Risk register and exceptions", () => {
  const grc = new GrcService();
  const risk = grc.risk.createRisk({
    organizationId: "org_1",
    title: "Data breach risk",
    description: "Risk of unauthorized access",
    category: "SECURITY" as any,
    source: "assessment",
    assetResourceRefs: [],
    likelihood: "MEDIUM" as any,
    impact: "HIGH" as any,
    inherentRisk: "HIGH" as any,
    controlRefs: [],
    owner: "risk_owner",
    status: "IDENTIFIED" as any,
    evidenceRefs: [],
  });
  
  assert.exists(risk.riskId);
  assert.equal(risk.status, "IDENTIFIED");
  
  const ex = grc.risk.createException({
    organizationId: "org_1",
    controlId: "ctrl_1",
    scope: "prod",
    reason: "temporary",
    requestedBy: "req",
    startsAt: new Date().toISOString(),
    compensatingControls: [],
    status: "REQUESTED" as any,
  });
  
  assert.exists(ex.exceptionId);
});

test("GRC: Policy management with versioning", () => {
  const grc = new GrcService();
  const pol = grc.policy.createPolicy({
    title: "Security Policy",
    purpose: "Security",
    scope: "ORG",
    owner: "owner",
    status: "DRAFT" as any,
    controlRefs: [],
    organizationId: "org_1",
    updatedBy: "owner",
  });
  
  assert.equal(pol.version, 1);
  
  const v2 = grc.policy.newVersion(pol.policyId, "content v2", "owner");
  assert.equal(v2.version, 2);
  assert.equal(v2.supersedesPolicyId, pol.policyId);
});

test("GRC: Trust center and findings", () => {
  const grc = new GrcService();
  const finding = grc.trust.createFinding({
    organizationId: "org_1",
    controlId: "ctrl_1",
    scope: "prod",
    severity: "HIGH" as any,
    title: "Finding",
    description: "Issue",
    evidence: [],
    status: "OPEN" as any,
    owner: "owner",
  } as any);
  
  assert.exists(finding.findingId);
  assert.equal(finding.status, "OPEN");
  
  grc.trust.updateFinding(finding.findingId, { status: "RESOLVED" as any });
});
