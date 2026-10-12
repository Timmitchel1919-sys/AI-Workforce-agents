import assert from "node:assert";
import { describe, it } from "node:test";
import type { SecurityActionContext } from "../../contracts/security-policy.js";
import { SecurityPolicyEngine } from "./security-policy-engine.js";

describe("SecurityPolicyEngine", () => {
  const engine = new SecurityPolicyEngine();

  const baseContext: SecurityActionContext = {
    action: "unknown",
    actorId: "op-123",
    actorType: "human",
    actorRole: "operator",
    targetResourceType: "command",
    destructive: false,
    irreversible: false,
    production: false,
    requestedAt: new Date().toISOString(),
  };

  it("1. denies audit log deletion explicitly (critical risk)", () => {
    const decision = engine.evaluate({ ...baseContext, action: "delete_audit_log", destructive: true });
    assert.strictEqual(decision.allowed, false);
    assert.strictEqual(decision.risk, "critical");
    assert.match(decision.reason, /Audit records are protected from destructive mutation/);
  });

  it("2. denies security event deletion explicitly (critical risk)", () => {
    const decision = engine.evaluate({ ...baseContext, action: "delete_security_incident", destructive: true });
    assert.strictEqual(decision.allowed, false);
    assert.strictEqual(decision.risk, "critical");
    assert.match(decision.reason, /Denied by policy: Security events and incidents cannot be arbitrarily deleted/);
  });

  it("3. denies raw secret reading explicitly (critical risk)", () => {
    const decision = engine.evaluate({ ...baseContext, action: "expose_secret" });
    assert.strictEqual(decision.allowed, false);
    assert.strictEqual(decision.risk, "critical");
    assert.match(decision.reason, /Denied by policy: Raw secret values cannot be read directly/);
  });

  it("4. denies unknown destructive actions by default", () => {
    const decision = engine.evaluate({ ...baseContext, action: "nuke_database", destructive: true });
    assert.strictEqual(decision.allowed, false);
    assert.strictEqual(decision.risk, "critical");
    assert.strictEqual(decision.reason, "Unknown destructive actions are denied by default");
  });

  it("5. implicitly allows unknown non-destructive actions (relying on RBAC)", () => {
    const decision = engine.evaluate({ ...baseContext, action: "ping_service", destructive: false });
    assert.strictEqual(decision.allowed, true);
    assert.strictEqual(decision.risk, "low");
    assert.strictEqual(decision.reason, "Action implicitly allowed (no overriding security policy)");
  });

  it("6. production destruction requires extreme authorization", () => {
    const decision = engine.evaluate({ ...baseContext, action: "delete_database", destructive: true, production: true });
    assert.strictEqual(decision.allowed, true); // It doesn't explicitly deny, but requires approval
    assert.strictEqual(decision.requiresApproval, true);
    assert.strictEqual(decision.requiresReauthentication, true);
    assert.strictEqual(decision.requiresMfa, true);
    assert.strictEqual(decision.risk, "critical");
    assert.strictEqual(decision.recommendedAlternative, "archive or soft-delete instead");
  });

  it("7. non-production destruction requires approval", () => {
    const decision = engine.evaluate({ ...baseContext, action: "delete_database", destructive: true, production: false });
    assert.strictEqual(decision.allowed, true);
    assert.strictEqual(decision.requiresApproval, true);
    assert.strictEqual(decision.risk, "high");
  });

  it("8. production deployments require governed approval", () => {
    const decision = engine.evaluate({ ...baseContext, action: "deploy_release", production: true });
    assert.strictEqual(decision.allowed, true);
    assert.strictEqual(decision.requiresApproval, true);
    assert.strictEqual(decision.requiresReauthentication, true);
    assert.strictEqual(decision.risk, "high");
  });

  it("9. security policy changes are high risk and require strict approval", () => {
    const decision = engine.evaluate({ ...baseContext, action: "manage_security_policy" });
    assert.strictEqual(decision.allowed, true);
    assert.strictEqual(decision.requiresApproval, true);
    assert.strictEqual(decision.requiresReauthentication, true);
    assert.strictEqual(decision.requiresMfa, true);
    assert.strictEqual(decision.risk, "high");
  });

  it("10. identity and access changes require approval", () => {
    const decision = engine.evaluate({ ...baseContext, action: "manage_access" });
    assert.strictEqual(decision.allowed, true);
    assert.strictEqual(decision.requiresApproval, true);
    assert.strictEqual(decision.requiresReauthentication, true);
    assert.strictEqual(decision.risk, "high");
  });

  it("11. secret management changes require approval", () => {
    const decision = engine.evaluate({ ...baseContext, action: "manage_secret_references" });
    assert.strictEqual(decision.allowed, true);
    assert.strictEqual(decision.requiresApproval, true);
    assert.strictEqual(decision.requiresReauthentication, true);
    assert.strictEqual(decision.risk, "high");
  });

  it("12. agent security changes are medium risk", () => {
    const decision = engine.evaluate({ ...baseContext, action: "disable_agent" });
    assert.strictEqual(decision.allowed, true);
    assert.strictEqual(decision.requiresApproval, false);
    assert.strictEqual(decision.risk, "medium");
  });

  it("13. standard mutations are medium risk", () => {
    const decision = engine.evaluate({ ...baseContext, action: "retry_task" });
    assert.strictEqual(decision.allowed, true);
    assert.strictEqual(decision.requiresApproval, false);
    assert.strictEqual(decision.risk, "medium");
  });

  it("14. read actions are low risk", () => {
    const decision = engine.evaluate({ ...baseContext, action: "view" });
    assert.strictEqual(decision.allowed, true);
    assert.strictEqual(decision.requiresApproval, false);
    assert.strictEqual(decision.risk, "low");
  });

  it("15. enforces system invariants against policy self-bypass", () => {
    // If we mock a custom engine with a policy that allows audit deletion,
    // the invariant should still deny it.
    const customEngine = new SecurityPolicyEngine([
      {
        id: "evil-policy",
        description: "Allow audit deletion",
        enabled: true,
        actionPatterns: ["delete_audit_log"],
        risk: "low",
        requiresApproval: false,
        requiresReauthentication: false,
        requiresMfa: false,
        requiresTwoPersonApproval: false,
        deny: false,
      }
    ]);
    const decision = customEngine.evaluate({ ...baseContext, action: "delete_audit_log", destructive: true });
    assert.strictEqual(decision.allowed, false);
    assert.strictEqual(decision.risk, "critical");
    assert.match(decision.reason, /Invariant: Audit records are protected/);
  });
});

