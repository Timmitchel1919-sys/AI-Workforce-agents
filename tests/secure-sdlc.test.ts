/**
 * Layer 8 — Secure SDLC, SAST, Dependency & Software Supply-Chain Security Tests
 */
import assert from "node:assert/strict";
import test from "node:test";
import { SecurityFindingStore } from "../core/security/security-finding-source.js";
import { DeploymentSecurityGate } from "../core/security/deployment-security-gate.js";
import { SecretLeakHandler } from "../core/security/secret-leak-handler.js";
import { InMemoryRepository } from "../core/persistence/in-memory-repository.js";
import {
  computeSha256,
  createBuildProvenance,
} from "../core/security/build-provenance.js";
import type {
  AsyncSecurityEventStore,
  CanonicalSecurityEvent,
  ManagedSecretReference,
  OperatorPrincipal,
  SecurityFinding,
} from "../contracts/index.js";

class TestSecurityEventStore implements AsyncSecurityEventStore {
  public events: CanonicalSecurityEvent[] = [];
  async append(event: CanonicalSecurityEvent): Promise<void> {
    this.events.push(event);
  }
  async query(): Promise<CanonicalSecurityEvent[]> {
    return [...this.events];
  }
}

const TEST_ADMIN: OperatorPrincipal = {
  id: "op-admin-1",
  role: "admin",
  allowedProjects: ["proj-alpha"],
};

test("SecurityFindingStore - manages finding lifecycle, statuses, and counts", () => {
  const repo = new InMemoryRepository<SecurityFinding>();
  const store = new SecurityFindingStore(repo);
  const finding1: SecurityFinding = {
    id: "f-1",
    source: "codeql",
    category: "sast",
    severity: "critical",
    title: "SQL Injection",
    description: "Unsanitized parameter in query",
    detectedAt: new Date().toISOString(),
    status: "open",
    remediation: "Use parameterized queries",
  };
  const finding2: SecurityFinding = {
    id: "f-2",
    source: "npm_audit",
    category: "dependency_vulnerability",
    severity: "high",
    title: "Vulnerable lodash",
    description: "Prototype pollution",
    detectedAt: new Date().toISOString(),
    status: "open",
    remediation: "Upgrade lodash",
  };

  store.ingest(finding1);
  store.ingest(finding2);

  assert.equal(store.list().length, 2);
  assert.equal(store.hasUnresolvedCritical(), true);
  assert.equal(store.list({ severity: "critical" }).length, 1);
  assert.equal(store.list({ category: "dependency_vulnerability" }).length, 1);

  // Update status to remediated
  store.updateStatus("f-1", "remediated", "Patched in commit 123");
  assert.equal(store.hasUnresolvedCritical(), false);
  assert.equal(store.list({ status: "remediated" }).length, 1);
});

test("DeploymentSecurityGate - enforces fail-closed deployments against vulnerabilities", () => {
  const repo = new InMemoryRepository<SecurityFinding>();
  const store = new SecurityFindingStore(repo);
  const events = new TestSecurityEventStore();
  const gate = new DeploymentSecurityGate(store, undefined, events);

  // 1. Clean build: allowed
  const cleanEval = gate.evaluateDeployment("production");
  assert.equal(cleanEval.allowed, true);
  assert.equal(cleanEval.blockedFindings.length, 0);

  // 2. Introduce critical SAST finding: must block
  const critFinding: SecurityFinding = {
    id: "f-crit-1",
    source: "codeql",
    category: "sast",
    severity: "critical",
    title: "Remote Code Execution",
    description: "Insecure deserialization",
    detectedAt: new Date().toISOString(),
    status: "open",
    remediation: "Validate serialization inputs",
  };
  store.ingest(critFinding);

  const blockedEval = gate.evaluateDeployment("production");
  assert.equal(blockedEval.allowed, false);
  assert.equal(blockedEval.blockedFindings.length, 1);
  assert.match(blockedEval.reason, /DEPLOYMENT_GATE_BLOCKED/);

  // 3. Expired override request: must still block
  const expiredOverride = {
    principal: TEST_ADMIN,
    findingIds: ["f-crit-1"],
    justification: "Temporary staging test",
    expiresAt: new Date(Date.now() - 3600000).toISOString(),
  };
  assert.throws(
    () => gate.evaluateDeployment("production", undefined, expiredOverride),
    /Emergency security override has expired/i,
  );

  // 4. Valid override request with authorized principal: allowed
  const validOverride = {
    principal: TEST_ADMIN,
    findingIds: ["f-crit-1"],
    justification: "Compensating WAF rule deployed, verified by SecOps",
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    reauthVerified: true,
    mfaVerified: true,
  };
  const overriddenEval = gate.evaluateDeployment(
    "production",
    undefined,
    validOverride,
  );
  assert.equal(overriddenEval.allowed, true);
  assert.equal(overriddenEval.overrideApplied, true);

  // 5. Verify audit events recorded
  assert.ok(events.events.length >= 2);
  const blockEvent = events.events.find((e) => e.outcome === "denied");
  const allowEvent = events.events.find((e) => e.outcome === "allowed");
  assert.ok(blockEvent);
  assert.ok(allowEvent);
});

test("SecretLeakHandler - flags references for rotation and ingests critical findings", async () => {
  const findRepo = new InMemoryRepository<SecurityFinding>();
  const store = new SecurityFindingStore(findRepo);
  const secretRepo = new InMemoryRepository<ManagedSecretReference>();
  const events = new TestSecurityEventStore();
  const handler = new SecretLeakHandler(store, secretRepo, events);

  const ref: ManagedSecretReference = {
    id: "sec-leak-ref",
    ref: "secret://sec-leak-ref",
    name: "STRIPE_SECRET_KEY",
    provider: "in_memory_vault",
    providerResource: "stripe_key",
    purpose: "Stripe key",
    status: "active",
    version: 1,
    environment: "production",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: "admin",
    updatedBy: "admin",
  };
  secretRepo.upsert(ref);

  const report = {
    file: "src/payments/stripe.ts",
    line: 42,
    ruleId: "stripe-api-token",
    description: "Hardcoded Stripe API Token detected",
    matchedReferenceId: "sec-leak-ref",
  };

  const finding = await handler.handleLeak(report);
  assert.equal(finding.category, "secret_leak");
  assert.equal(finding.severity, "critical");

  // Verify finding ingested into store
  assert.equal(store.hasUnresolvedCritical(), true);

  // Verify matched managed secret reference flagged for rotation
  const updatedRef = secretRepo.findById("sec-leak-ref");
  assert.ok(updatedRef);
  assert.equal(updatedRef.status, "rotation_required");
  assert.ok(updatedRef.rotationDueAt);

  // Verify event appended
  assert.equal(events.events.length, 1);
  assert.equal(events.events[0].type, "secret_leak_detected");
  assert.equal(events.events[0].severity, "critical");
});

test("Build Provenance - computes deterministic digests and attestation manifests", () => {
  const content = Buffer.from("console.log('hello world');", "utf-8");
  const digest = computeSha256(content);
  assert.match(digest, /^[a-f0-9]{64}$/);

  const provenance = createBuildProvenance({
    commitSha: "93c908d4f0011223344",
    lockfileContent: "lockfile-checksum-sample",
    artifacts: {
      "bundle.js": content,
    },
    sbomReference: "dist/sbom-root.json",
  });

  assert.equal(provenance.commitSha, "93c908d4f0011223344");
  assert.equal(provenance.artifactHashes["bundle.js"], digest);
  assert.ok(provenance.nodeVersion);
});
