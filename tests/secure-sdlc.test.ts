import assert from "node:assert/strict";
import test from "node:test";
import type { SecurityFinding } from "../contracts/security-build.js";
import { BuildSecurityGateService } from "../core/security/build-security-gate.js";
import { PackageAdmissionPolicy } from "../core/security/package-admission-policy.js";
import { SecurityExceptionStore } from "../core/security/security-exception-store.js";

// Scenario 1: Clean codebase -> security gate passes
test("sdlc: 1. clean codebase passes security gate", async () => {
  const gate = new BuildSecurityGateService();
  const result = await gate.evaluateGate({
    environment: "production",
    findings: [],
    checks: [
      { checkType: "typecheck", status: "passed", durationMs: 100, findingsCount: 0 },
      { checkType: "test", status: "passed", durationMs: 200, findingsCount: 0 },
      { checkType: "secret_scan", status: "passed", durationMs: 50, findingsCount: 0 },
      { checkType: "dependency_scan", status: "passed", durationMs: 80, findingsCount: 0 },
      { checkType: "sast", status: "passed", durationMs: 120, findingsCount: 0 },
    ],
    artifactContent: Buffer.from("build-output-v1"),
  });

  assert.equal(result.allowed, true);
  assert.equal(result.blockingFindings.length, 0);
  assert.ok(result.artifactHash);
});

// Scenario 2: Fake committed secret fixture -> secret scanner blocks
test("sdlc: 2. secret leak blocks security gate", async () => {
  const gate = new BuildSecurityGateService();
  const secretFinding: SecurityFinding = {
    id: "SEC-LEAK-01",
    checkType: "secret_scan",
    severity: "critical",
    title: "Committed Anthropic API Key",
    description: "sk-ant-api03 key detected in codebase",
    blocking: true,
    detectedAt: new Date().toISOString(),
  };

  const result = await gate.evaluateGate({
    environment: "production",
    findings: [secretFinding],
    checks: [
      { checkType: "typecheck", status: "passed", durationMs: 100, findingsCount: 0 },
      { checkType: "test", status: "passed", durationMs: 200, findingsCount: 0 },
      { checkType: "secret_scan", status: "failed", durationMs: 50, findingsCount: 1 },
      { checkType: "dependency_scan", status: "passed", durationMs: 80, findingsCount: 0 },
      { checkType: "sast", status: "passed", durationMs: 120, findingsCount: 0 },
    ],
  });

  assert.equal(result.allowed, false);
  assert.ok(result.blockingFindings.includes("SEC-LEAK-01"));
});

// Scenario 3 & 4: Critical / High vulnerable dependency -> production gate blocks
test("sdlc: 3 & 4. critical or high vulnerable dependency blocks production", async () => {
  const gate = new BuildSecurityGateService();
  const depFinding: SecurityFinding = {
    id: "DEP-VULN-99",
    checkType: "dependency_scan",
    severity: "high",
    title: "Remote Code Execution in express-fileupload",
    description: "High severity CVE-2023-12345",
    packageName: "express-fileupload",
    blocking: true,
    detectedAt: new Date().toISOString(),
  };

  const result = await gate.evaluateGate({
    environment: "production",
    findings: [depFinding],
    checks: [
      { checkType: "typecheck", status: "passed", durationMs: 100, findingsCount: 0 },
      { checkType: "test", status: "passed", durationMs: 200, findingsCount: 0 },
      { checkType: "secret_scan", status: "passed", durationMs: 50, findingsCount: 0 },
      { checkType: "dependency_scan", status: "failed", durationMs: 80, findingsCount: 1 },
      { checkType: "sast", status: "passed", durationMs: 120, findingsCount: 0 },
    ],
  });

  assert.equal(result.allowed, false);
  assert.ok(result.blockingFindings.includes("DEP-VULN-99"));
});

// Scenario 5: SAST critical finding -> blocked
test("sdlc: 5. SAST critical finding blocks security gate", async () => {
  const gate = new BuildSecurityGateService();
  const sastFinding: SecurityFinding = {
    id: "SAST-EVAL-01",
    checkType: "sast",
    severity: "critical",
    title: "Arbitrary Code Execution via eval()",
    description: "eval() call found in request handler",
    filePath: "api/handler.ts",
    ruleId: "SAST-001",
    blocking: true,
    detectedAt: new Date().toISOString(),
  };

  const result = await gate.evaluateGate({
    environment: "production",
    findings: [sastFinding],
    checks: [
      { checkType: "typecheck", status: "passed", durationMs: 100, findingsCount: 0 },
      { checkType: "test", status: "passed", durationMs: 200, findingsCount: 0 },
      { checkType: "secret_scan", status: "passed", durationMs: 50, findingsCount: 0 },
      { checkType: "dependency_scan", status: "passed", durationMs: 80, findingsCount: 0 },
      { checkType: "sast", status: "failed", durationMs: 120, findingsCount: 1 },
    ],
  });

  assert.equal(result.allowed, false);
  assert.ok(result.blockingFindings.includes("SAST-EVAL-01"));
});

// Scenario 6: Medium finding non-blocking -> passes with warnings
test("sdlc: 6. medium non-blocking finding passes with warning", async () => {
  const gate = new BuildSecurityGateService();
  const medFinding: SecurityFinding = {
    id: "SAST-PATH-01",
    checkType: "sast",
    severity: "medium",
    title: "Potential path join optimization",
    description: "Path join could be sanitized",
    filePath: "utils/path.ts",
    blocking: false,
    detectedAt: new Date().toISOString(),
  };

  const result = await gate.evaluateGate({
    environment: "staging",
    findings: [medFinding],
    checks: [
      { checkType: "typecheck", status: "passed", durationMs: 100, findingsCount: 0 },
      { checkType: "test", status: "passed", durationMs: 200, findingsCount: 0 },
      { checkType: "secret_scan", status: "passed", durationMs: 50, findingsCount: 0 },
      { checkType: "dependency_scan", status: "passed", durationMs: 80, findingsCount: 0 },
      { checkType: "sast", status: "passed", durationMs: 120, findingsCount: 1 },
    ],
  });

  assert.equal(result.allowed, true);
  assert.equal(result.blockingFindings.length, 0);
});

// Scenario 7: Missing mandatory scanner result -> production fails closed
test("sdlc: 7. missing mandatory scanner result in production fails closed", async () => {
  const gate = new BuildSecurityGateService();
  const result = await gate.evaluateGate({
    environment: "production",
    findings: [],
    checks: [
      { checkType: "typecheck", status: "passed", durationMs: 100, findingsCount: 0 },
      { checkType: "test", status: "passed", durationMs: 200, findingsCount: 0 },
      // Missing secret_scan, dependency_scan, sast
    ],
  });

  assert.equal(result.allowed, false);
  assert.ok(result.blockingFindings.some((id) => id.includes("MANDATORY_CHECK_FAILED")));
});

// Scenario 8: Expired exception -> finding blocks again
test("sdlc: 8. expired exception no longer waives finding", async () => {
  const exceptionStore = new SecurityExceptionStore();
  const gate = new BuildSecurityGateService({ exceptionStore });

  // Create expired exception
  await exceptionStore.createException({
    id: "EX-EXP-1",
    findingId: "DEP-EXPIRED-01",
    reason: "Temporary waiver for staging test",
    riskAcceptedBy: "secops-lead",
    expiresAt: new Date(Date.now() - 60_000).toISOString(), // 1 minute ago
    environment: "production",
    remediationDueAt: new Date(Date.now() + 86400_000).toISOString(),
    correlationId: "c-exp-1",
  });

  const finding: SecurityFinding = {
    id: "DEP-EXPIRED-01",
    checkType: "dependency_scan",
    severity: "high",
    title: "Vulnerable package",
    description: "Requires update",
    blocking: true,
    detectedAt: new Date().toISOString(),
  };

  const result = await gate.evaluateGate({
    environment: "production",
    findings: [finding],
    checks: [
      { checkType: "typecheck", status: "passed", durationMs: 100, findingsCount: 0 },
      { checkType: "test", status: "passed", durationMs: 200, findingsCount: 0 },
      { checkType: "secret_scan", status: "passed", durationMs: 50, findingsCount: 0 },
      { checkType: "dependency_scan", status: "failed", durationMs: 80, findingsCount: 1 },
      { checkType: "sast", status: "passed", durationMs: 120, findingsCount: 0 },
    ],
  });

  assert.equal(result.allowed, false);
  assert.ok(result.blockingFindings.includes("DEP-EXPIRED-01"));
});

// Scenario 9: Valid time-limited exception -> allowed in configured environment
test("sdlc: 9. valid active exception waives non-critical finding", async () => {
  const exceptionStore = new SecurityExceptionStore();
  const gate = new BuildSecurityGateService({ exceptionStore });

  await exceptionStore.createException({
    id: "EX-VALID-1",
    findingId: "DEP-WAIVED-01",
    reason: "Vendor fix pending release next week",
    riskAcceptedBy: "ciso",
    expiresAt: new Date(Date.now() + 86400_000 * 7).toISOString(), // +7 days
    environment: "production",
    remediationDueAt: new Date(Date.now() + 86400_000 * 7).toISOString(),
    correlationId: "c-val-1",
  });

  const finding: SecurityFinding = {
    id: "DEP-WAIVED-01",
    checkType: "dependency_scan",
    severity: "high",
    title: "High severity finding with active waiver",
    description: "Temporarily accepted risk",
    blocking: true,
    detectedAt: new Date().toISOString(),
  };

  const result = await gate.evaluateGate({
    environment: "production",
    findings: [finding],
    checks: [
      { checkType: "typecheck", status: "passed", durationMs: 100, findingsCount: 0 },
      { checkType: "test", status: "passed", durationMs: 200, findingsCount: 0 },
      { checkType: "secret_scan", status: "passed", durationMs: 50, findingsCount: 0 },
      { checkType: "dependency_scan", status: "passed", durationMs: 80, findingsCount: 1 },
      { checkType: "sast", status: "passed", durationMs: 120, findingsCount: 0 },
    ],
  });

  assert.equal(result.allowed, true);
  assert.equal(result.blockingFindings.length, 0);
});

// Scenario 10: Exception for secret leak -> CANNOT bypass
test("sdlc: 10. secret leak cannot be bypassed by exception", async () => {
  const exceptionStore = new SecurityExceptionStore();
  const gate = new BuildSecurityGateService({ exceptionStore });

  await exceptionStore.createException({
    id: "EX-SECRET-FAIL",
    findingId: "SEC-UNBYPASSABLE",
    reason: "Attempted waiver for secret leak",
    riskAcceptedBy: "admin",
    expiresAt: new Date(Date.now() + 86400_000).toISOString(),
    environment: "production",
    remediationDueAt: new Date(Date.now() + 86400_000).toISOString(),
    correlationId: "c-sec-fail",
  });

  const secretFinding: SecurityFinding = {
    id: "SEC-UNBYPASSABLE",
    checkType: "secret_scan",
    severity: "critical",
    title: "Committed Secret",
    description: "Hardcoded API Key",
    blocking: true,
    detectedAt: new Date().toISOString(),
  };

  const result = await gate.evaluateGate({
    environment: "production",
    findings: [secretFinding],
    checks: [
      { checkType: "typecheck", status: "passed", durationMs: 100, findingsCount: 0 },
      { checkType: "test", status: "passed", durationMs: 200, findingsCount: 0 },
      { checkType: "secret_scan", status: "failed", durationMs: 50, findingsCount: 1 },
      { checkType: "dependency_scan", status: "passed", durationMs: 80, findingsCount: 0 },
      { checkType: "sast", status: "passed", durationMs: 120, findingsCount: 0 },
    ],
  });

  assert.equal(result.allowed, false);
  assert.ok(result.blockingFindings.includes("SEC-UNBYPASSABLE"));
});

// Scenario 11: Build Provenance & Artifact Hash
test("sdlc: 11. build provenance generates artifact hash and lockfile digest", async () => {
  const gate = new BuildSecurityGateService();
  const gateResult = await gate.evaluateGate({
    environment: "production",
    findings: [],
    checks: [
      { checkType: "typecheck", status: "passed", durationMs: 100, findingsCount: 0 },
      { checkType: "test", status: "passed", durationMs: 200, findingsCount: 0 },
      { checkType: "secret_scan", status: "passed", durationMs: 50, findingsCount: 0 },
      { checkType: "dependency_scan", status: "passed", durationMs: 80, findingsCount: 0 },
      { checkType: "sast", status: "passed", durationMs: 120, findingsCount: 0 },
    ],
    artifactContent: "final-production-bundle-payload",
  });

  const provenance = await gate.generateBuildProvenance(
    "build-999",
    gateResult,
    '{"name": "ai-workforce-agents"}'
  );

  assert.equal(provenance.buildId, "build-999");
  assert.ok(provenance.artifactHash);
  assert.ok(provenance.lockfileHash);
  assert.equal(provenance.environment, "production");
});

// Scenario 12: Package Admission Policy
test("sdlc: 12. package admission policy rejects blacklisted and unrationalized packages", () => {
  const policy = new PackageAdmissionPolicy();

  // Blacklisted package
  const res1 = policy.evaluate({
    packageName: "event-stream",
    requestedVersion: "3.3.6",
    requestedBy: "agent-dev",
    reason: "Needed for streaming data",
    intendedUse: "data processing",
  });
  assert.equal(res1.allowed, false);
  assert.match(res1.reason, /blacklisted/);

  // Insufficient reason
  const res2 = policy.evaluate({
    packageName: "some-lib",
    requestedVersion: "1.0.0",
    requestedBy: "agent-dev",
    reason: "convenient",
    intendedUse: "test",
  });
  assert.equal(res2.allowed, false);
  assert.match(res2.reason, /justification/);

  // Valid package
  const res3 = policy.evaluate({
    packageName: "zod",
    requestedVersion: "^3.22.4",
    requestedBy: "developer-1",
    reason: "Schema validation for Control Plane incoming payload contracts",
    intendedUse: "contract verification",
  });
  assert.equal(res3.allowed, true);
});

// Scenario 13: Deployment without security evidence is denied
test("sdlc: 13. deployment without security evidence is denied", async () => {
  const gate = new BuildSecurityGateService();
  const result = await gate.evaluateGate({
    environment: "production",
    findings: [],
    checks: [], // Empty checks array
  });

  assert.equal(result.allowed, false);
  assert.match(result.reason, /FAILED/);
});
