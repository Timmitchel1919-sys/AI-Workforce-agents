import test from "node:test";
import { assert } from "./helpers/assert.js";
import { ProcurementService } from "../core/procurement/index.js";
import { Vendor, VendorQualification, ProcurementRequest, ContractRecord, SoftwareLicense, RenewalCase } from "../contracts/procurement.js";

test("Procurement: CROSS-TENANT VENDOR - Org A cannot access Org B vendor", async () => {
  const svc = new ProcurementService();
  await svc.registerVendor({
    id: "v_b",
    vendorId: "vendor_b",
    organizationId: "org_B",
    legalName: "Vendor B",
    displayName: "Vendor B",
    category: "SOFTWARE",
    status: "ACTIVE",
    contractRefs: [],
    integrationRefs: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  try {
    await svc.getVendor("org_A", "vendor_b");
    assert.ok(false, "Should throw tenant isolation violation");
  } catch (e: any) {
    assert.include(e.message, "Tenant isolation violation");
  }
});

test("Procurement: DUPLICATE VENDOR - Same legal vendor submitted twice prevents silent merge", async () => {
  const svc = new ProcurementService();
  const v: Vendor = {
    id: "v_1",
    vendorId: "vendor_1",
    organizationId: "org_A",
    legalName: "Vendor A",
    displayName: "Vendor A",
    category: "SOFTWARE",
    status: "ACTIVE",
    contractRefs: [],
    integrationRefs: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await svc.registerVendor(v);

  try {
    await svc.registerVendor(v);
    assert.ok(false, "Should throw duplicate vendor error");
  } catch (e: any) {
    assert.include(e.message, "already exists");
  }
});

test("Procurement: VENDOR QUALIFICATION - Qualification is scoped, not inherited for restricted workloads", async () => {
  const svc = new ProcurementService();
  await svc.qualifyVendor({
    id: "q_1",
    qualificationId: "qual_1",
    organizationId: "org_A",
    vendorId: "vendor_A",
    approvedScope: ["public-data"],
    restrictedScope: ["restricted-customer-data"],
    status: "VALID",
    createdAt: new Date().toISOString()
  });

  const canPublic = await svc.isVendorQualifiedFor("org_A", "vendor_A", "public-data");
  assert.equal(canPublic, true);

  const canRestricted = await svc.isVendorQualifiedFor("org_A", "vendor_A", "restricted-customer-data");
  assert.equal(canRestricted, false);
});

test("Procurement: REQUEST / PURCHASE - Approved request does not mean PURCHASED", async () => {
  const svc = new ProcurementService();
  const req: ProcurementRequest = {
    id: "r_1",
    requestId: "req_1",
    organizationId: "org_A",
    requesterRef: "user_1",
    category: "SOFTWARE",
    description: "Need new tool",
    businessJustification: "Yes",
    technicalRequirements: [],
    securityRequirements: [],
    dataClassification: "PUBLIC",
    status: "DRAFT",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await svc.submitRequest(req);
  const approved = await svc.approveRequest("org_A", "req_1");
  assert.equal(approved.status, "APPROVED");
  // The system preserves the status as APPROVED, not implying PURCHASED until a PO is issued.
});

test("Procurement: CONTRACT ACCESS - Project member without permission denied", async () => {
  const svc = new ProcurementService();
  await svc.addContract({
    id: "c_1",
    contractId: "contract_1",
    organizationId: "org_A",
    vendorId: "vendor_A",
    contractType: "MSA",
    title: "Vendor A MSA",
    effectiveDate: new Date().toISOString(),
    renewalType: "AUTO",
    currency: "USD",
    version: 1,
    status: "EXECUTED",
    ownerRef: "user_owner",
    terms: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  try {
    await svc.getContract("org_A", "contract_1", false);
    assert.ok(false, "Should deny access");
  } catch (e: any) {
    assert.include(e.message, "Access Denied");
  }

  const contract = await svc.getContract("org_A", "contract_1", true);
  assert.equal(contract.contractId, "contract_1");
});

test("Procurement: AI CONTRACT EXTRACTION - Extracted terms are UNVERIFIED", async () => {
  const svc = new ProcurementService();
  const c = await svc.addContract({
    id: "c_2",
    contractId: "contract_2",
    organizationId: "org_A",
    vendorId: "vendor_A",
    contractType: "MSA",
    title: "AI Extracted MSA",
    effectiveDate: new Date().toISOString(),
    renewalType: "AUTO",
    currency: "USD",
    version: 1,
    status: "EXECUTED",
    ownerRef: "user_owner",
    terms: {
      pricing: "1000/yr",
      extractedByAi: true,
      verified: false
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  assert.equal(c.terms.extractedByAi, true);
  assert.equal(c.terms.verified, false);
});

test("Procurement: LICENSE ASSIGNMENT & UTILIZATION - Do not infer usage", async () => {
  const svc = new ProcurementService();
  await svc.addLicense({
    id: "l_1",
    licenseId: "lic_1",
    organizationId: "org_A",
    vendorId: "vendor_A",
    productName: "Tool",
    licenseType: "PER_SEAT",
    quantity: 100,
    assignedQuantity: 0,
    availableQuantity: 100,
    start: new Date().toISOString(),
    status: "ACTIVE",
    createdAt: new Date().toISOString()
  });

  const updated = await svc.assignLicense("org_A", "lic_1", 80);
  assert.equal(updated.assignedQuantity, 80);
  assert.equal(updated.availableQuantity, 20);

  const util = await svc.getLicenseUtilization("org_A", "lic_1");
  assert.equal(util.assigned, 80);
  assert.equal(util.used, "UNKNOWN");
});

test("Procurement: RENEWAL - Auto-renew date approaches does not mean autonomous approval", async () => {
  const svc = new ProcurementService();
  const renewal = await svc.createRenewalCase({
    id: "ren_1",
    renewalId: "renewal_1",
    organizationId: "org_A",
    contractId: "c_1",
    vendorId: "vendor_A",
    renewalDate: new Date().toISOString(),
    noticeDeadline: new Date().toISOString(),
    status: "OPEN",
    createdAt: new Date().toISOString()
  });

  const rec = await svc.generateRenewalRecommendation("org_A", "renewal_1");
  assert.equal(rec.recommendation, "REVIEW_REQUIRED");
  assert.equal(rec.status, "OPEN"); // Still open, not auto-approved
});
