/**
 * Security Policy Engine (Layer 2) — deterministic decisions.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  InMemorySecurityPolicyStore,
  SecurityPolicyEngine,
  defaultSecurityPolicies,
} from "../core/security/security-policy-engine.js";
import type { SecurityActionContext } from "../contracts/index.js";

const CLOCK = () => "2026-10-12T00:00:00.000Z";

function engineWithDefaults(): SecurityPolicyEngine {
  return new SecurityPolicyEngine(
    new InMemorySecurityPolicyStore(defaultSecurityPolicies(CLOCK)),
  );
}

function ctx(overrides: Partial<SecurityActionContext>): SecurityActionContext {
  return {
    action: "read.project",
    actorId: "op-1",
    actorType: "human",
    role: "operator",
    projectId: "p1",
    environment: "production",
    targetResourceType: "project",
    targetResourceId: "p1",
    destructive: false,
    irreversible: false,
    production: true,
    requestedAt: CLOCK(),
    correlationId: "corr-1",
    ...overrides,
  };
}

test("policy engine: normal authorized read is low and allowed", () => {
  const d = engineWithDefaults().evaluate(ctx({ action: "read.project" }));
  assert.equal(d.allowed, true);
  assert.equal(d.risk, "low");
  assert.equal(d.requiresApproval, false);
  assert.ok(d.matchedPolicyIds.includes("sec.a.read.allow"));
});

test("policy engine: unknown non-sensitive action is DENIED (fail-closed)", () => {
  const d = engineWithDefaults().evaluate(
    ctx({ action: "frobnicate.widget", destructive: false }),
  );
  assert.equal(d.allowed, false);
  assert.match(d.reason, /SECURITY_POLICY_UNKNOWN/);
});

test("policy engine: inherently destructive unknown action requires approval + risk high", () => {
  const d = engineWithDefaults().evaluate(
    ctx({
      action: "delete.unknown_resource",
      destructive: true,
      irreversible: false,
      production: false,
      environment: "staging",
    }),
  );
  assert.equal(d.allowed, true);
  assert.equal(d.requiresApproval, true);
  assert.equal(d.risk, "high");
});

test("policy engine: destructive + irreversible + production → critical + two-person + MFA", () => {
  const d = engineWithDefaults().evaluate(
    ctx({
      action: "delete.project",
      destructive: true,
      irreversible: true,
      production: true,
    }),
  );
  assert.equal(d.requiresApproval, true);
  assert.equal(d.risk, "critical");
  assert.equal(d.requiresTwoPersonApproval, true);
  assert.equal(d.requiresMfa, true);
});

test("policy engine: raw secret export is a prohibited invariant (DENY, critical)", () => {
  const d = engineWithDefaults().evaluate(ctx({ action: "secret.export.raw" }));
  assert.equal(d.allowed, false);
  assert.equal(d.risk, "critical");
  assert.match(d.reason, /INVARIANT/);
});

test("policy engine: audit history deletion is a prohibited invariant (DENY, critical)", () => {
  const d = engineWithDefaults().evaluate(
    ctx({ action: "audit.history.delete" }),
  );
  assert.equal(d.allowed, false);
  assert.equal(d.risk, "critical");
});

test("policy engine: security event history deletion is a prohibited invariant", () => {
  const d = engineWithDefaults().evaluate(
    ctx({ action: "security_event.history.delete" }),
  );
  assert.equal(d.allowed, false);
  assert.equal(d.risk, "critical");
});

test("policy engine: explicit deny policy wins over an allow policy", () => {
  const policies = [
    {
      id: "allow",
      name: "allow",
      enabled: true,
      actionPatterns: ["read.*"],
      risk: "low" as const,
      effect: "allow" as const,
      priority: 100,
      reason: "allow",
      createdAt: CLOCK(),
      updatedAt: CLOCK(),
    },
    {
      id: "deny",
      name: "deny",
      enabled: true,
      actionPatterns: ["read.sensitive"],
      risk: "high" as const,
      effect: "deny" as const,
      priority: 10,
      reason: "deny-sensitive",
      createdAt: CLOCK(),
      updatedAt: CLOCK(),
    },
  ];
  const engine = new SecurityPolicyEngine(
    new InMemorySecurityPolicyStore(policies),
  );
  const d = engine.evaluate(ctx({ action: "read.sensitive" }));
  assert.equal(d.allowed, false);
  assert.equal(d.risk, "high");
  assert.ok(d.matchedPolicyIds.includes("deny"));
});

test("policy engine: multiple matched policies accumulate strongest requirements", () => {
  const policies = [
    {
      id: "mfa",
      name: "mfa",
      enabled: true,
      actionPatterns: ["x.*"],
      risk: "medium" as const,
      effect: "require_approval" as const,
      requiresMfa: true,
      priority: 10,
      reason: "mfa",
      createdAt: CLOCK(),
      updatedAt: CLOCK(),
    },
    {
      id: "reauth",
      name: "reauth",
      enabled: true,
      actionPatterns: ["x.*"],
      risk: "high" as const,
      effect: "require_approval" as const,
      requiresReauthentication: true,
      priority: 20,
      reason: "reauth",
      createdAt: CLOCK(),
      updatedAt: CLOCK(),
    },
  ];
  const engine = new SecurityPolicyEngine(
    new InMemorySecurityPolicyStore(policies),
  );
  const d = engine.evaluate(ctx({ action: "x.touch" }));
  assert.equal(d.requiresMfa, true);
  assert.equal(d.requiresReauthentication, true);
  assert.equal(d.requiresApproval, true);
  assert.equal(d.risk, "high");
});

test("policy engine: production security policy mutation requires approval + reauth + MFA", () => {
  const d = engineWithDefaults().evaluate(
    ctx({
      action: "security_policy.update",
      targetResourceType: "security_policy",
      environment: "production",
    }),
  );
  assert.equal(d.requiresApproval, true);
  assert.equal(d.requiresReauthentication, true);
  assert.equal(d.requiresMfa, true);
  assert.equal(d.risk, "high");
});

test("policy engine: deployment to production requires approval", () => {
  const d = engineWithDefaults().evaluate(
    ctx({ action: "deploy_release", environment: "production" }),
  );
  assert.equal(d.requiresApproval, true);
  assert.equal(d.risk, "high");
});
