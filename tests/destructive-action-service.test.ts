/**
 * Destructive Action Approval Gate (Layer 3) — approval lifecycle +
 * TOCTOU execution guard.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { ApprovalSystem } from "../core/approvals/approval-system.js";
import {
  DestructiveActionService,
  assertDestructiveActionApproved,
} from "../core/security/destructive-action-service.js";
import {
  InMemorySecurityPolicyStore,
  SecurityPolicyEngine,
  defaultSecurityPolicies,
} from "../core/security/security-policy-engine.js";
import type {
  DestructiveActionJustification,
  DestructiveActionRequestDraft,
  OperatorPrincipal,
  SecurityMfaEvidence,
  SecurityReauthenticationEvidence,
} from "../contracts/index.js";

function freshReauth(): SecurityReauthenticationEvidence {
  return {
    verified: true,
    verifiedAt: new Date().toISOString(),
    method: "password",
  };
}
function _freshMfa(): SecurityMfaEvidence {
  return {
    verified: true,
    verifiedAt: new Date().toISOString(),
    method: "totp",
  };
}

const CLOCK = () => "2026-10-12T00:00:00.000Z";

const REQUESTER: OperatorPrincipal = {
  id: "op-1",
  role: "operator",
  allowedProjects: ["p1"],
};
const APPROVER: OperatorPrincipal = {
  id: "admin-1",
  role: "admin",
  allowedProjects: ["p1"],
};
const APPROVER2: OperatorPrincipal = {
  id: "admin-2",
  role: "admin",
  allowedProjects: ["p1"],
};

/**
 * Trivial in-memory resolver backed by the test principals. The
 * production composition wires a real resolver backed by the
 * authoritative access-control store; this test fixture mirrors its
 * shape without duplicating the identity logic.
 */
function makeTestResolver(principals: readonly OperatorPrincipal[]) {
  const map = new Map(principals.map((p) => [p.id, p]));
  return { resolve: (id: string) => map.get(id) };
}

function makeService(opts: { withResolver?: boolean } = {}) {
  const engine = new SecurityPolicyEngine(
    new InMemorySecurityPolicyStore(defaultSecurityPolicies(CLOCK)),
  );
  const approvals = new ApprovalSystem();
  const resolver =
    opts.withResolver === false
      ? undefined
      : makeTestResolver([REQUESTER, APPROVER, APPROVER2]);
  return new DestructiveActionService(engine, approvals, undefined, resolver);
}
const UNAUTHORIZED: OperatorPrincipal = {
  id: "viewer-1",
  role: "viewer",
  allowedProjects: ["p1"],
};
const WRONG_PROJECT: OperatorPrincipal = {
  id: "op-2",
  role: "operator",
  allowedProjects: ["p2"],
};

function justification(
  overrides: Partial<DestructiveActionJustification> = {},
): DestructiveActionJustification {
  return {
    summary: "Deprecate the legacy orders table",
    reason: "superseded by v2 schema",
    blockerOrHindrance: "retention requires it before archival",
    expectedImpact: "the v1 reports stop; v2 continues",
    affectedResources: ["orders_v1"],
    affectedUsers: [],
    affectedWorkflows: [],
    affectedIntegrations: [],
    saferAlternatives: [
      {
        alternative: "archive",
        feasible: true,
        reason: "cold storage available",
        recommended: false,
      },
    ],
    selectedAlternativeReason: "archive is more expensive long-term",
    reversible: false,
    backupAvailable: true,
    recoveryPlan: "restore from nightly backup within 24h",
    rollbackAvailable: true,
    dataRetentionImpact: "satisfies retention floor",
    complianceImpact: "no PII impact",
    risk: "high",
    ...overrides,
  };
}

function draft(
  overrides: Partial<DestructiveActionRequestDraft> = {},
): DestructiveActionRequestDraft {
  // Default to a staging, reversible single-person destructive request so
  // tests can exercise the vanilla approve → execute → verify path.
  // Individual cases that need two-person / critical override explicitly.
  return {
    actionType: "delete_data",
    action: "delete.record",
    targetResourceType: "orders_table",
    targetResourceId: "orders_v1",
    environment: "staging",
    production: false,
    irreversible: false,
    projectId: "p1",
    justification: justification(),
    ...overrides,
  };
}

test("destructive: operator with capability may request; viewer cannot", () => {
  const s = makeService();
  const req = s.request(REQUESTER, draft(), "corr-1");
  assert.equal(req.status, "awaiting_approval");
  assert.ok(req.approvalId);

  assert.throws(
    () => s.request(UNAUTHORIZED, draft(), "corr-2"),
    /request_destructive_action/,
  );
});

test("destructive: incomplete justification is rejected", () => {
  const s = makeService();
  assert.throws(
    () =>
      s.request(
        REQUESTER,
        draft({ justification: justification({ summary: "" }) }),
        "corr-3",
      ),
    /justification incomplete/,
  );
});

test("destructive: wrong project is forbidden even with capability", () => {
  const s = makeService();
  assert.throws(
    () => s.request(WRONG_PROJECT, draft(), "corr-4"),
    /project 'p1'/,
  );
});

test("destructive: requester cannot approve own request (separation of duties)", () => {
  const s = makeService();
  const req = s.request(REQUESTER, draft(), "corr-5");
  // Give the requester approve capability by swapping role for the test — we
  // call decide() with a principal that has the SAME id as the requester to
  // force the SoD guard to engage.
  const requesterAsApprover: OperatorPrincipal = {
    id: REQUESTER.id,
    role: "admin",
    allowedProjects: ["p1"],
  };
  assert.throws(
    () => s.decide(requesterAsApprover, req.id, "approve"),
    /separation of duties/,
  );
});

test("destructive: operator without approve capability cannot approve", () => {
  const s = makeService();
  const req = s.request(REQUESTER, draft(), "corr-6");
  assert.throws(
    () =>
      s.decide(
        { id: "op-x", role: "operator", allowedProjects: ["p1"] },
        req.id,
        "approve",
      ),
    /approve_destructive_action/,
  );
});

test("destructive: critical irreversible production action requires two-person approval", () => {
  const s = makeService();
  const req = s.request(
    REQUESTER,
    draft({
      action: "delete.project",
      environment: "production",
      production: true,
      irreversible: true,
    }),
    "corr-7",
  );
  assert.equal(req.policyDecision.requiresTwoPersonApproval, true);
  // First approver.
  const after1 = s.decide(APPROVER, req.id, "approve", "primary");
  assert.equal(after1.status, "awaiting_approval");
  assert.ok(after1.secondaryApprovalId);
  // Same approver cannot be the second person.
  assert.throws(
    () => s.decide(APPROVER, req.id, "approve", "second-attempt"),
    /distinct second approver/,
  );
  // Distinct second approver completes.
  const after2 = s.decide(APPROVER2, req.id, "approve", "secondary");
  assert.equal(after2.status, "approved");
});

test("destructive: permanent production delete without backup/rollback is blocked", () => {
  const s = makeService();
  assert.throws(
    () =>
      s.request(
        REQUESTER,
        draft({
          action: "delete.project",
          irreversible: true,
          justification: justification({
            backupAvailable: false,
            rollbackAvailable: false,
          }),
        }),
        "corr-8",
      ),
    /no backup or rollback evidence/,
  );
});

test("destructive: audit deletion is denied by the engine before the service accepts it", () => {
  const s = makeService();
  assert.throws(
    () =>
      s.request(REQUESTER, draft({ action: "audit.history.delete" }), "corr-9"),
    /Security policy denied/,
  );
});

test("destructive: execution guard refuses when target changed since approval", () => {
  const s = makeService();
  const req = s.request(REQUESTER, draft(), "corr-10");
  s.decide(APPROVER, req.id, "approve", "ok");
  // Different targetResourceId — TOCTOU mismatch.
  assert.throws(
    () =>
      assertDestructiveActionApproved(s, {
        requestId: req.id,
        principal: APPROVER,
        actionType: "delete_data",
        targetResourceType: "orders_table",
        targetResourceId: "orders_v2",
        environment: "staging",
        projectId: "p1",
      }),
    /target changed/,
  );
});

test("destructive: approved → executing → executed only after verified markExecuted", () => {
  const s = makeService();
  const req = s.request(REQUESTER, draft(), "corr-11");
  s.decide(APPROVER, req.id, "approve", "ok");
  const executing = assertDestructiveActionApproved(s, {
    requestId: req.id,
    principal: APPROVER,
    actionType: "delete_data",
    targetResourceType: "orders_table",
    targetResourceId: "orders_v1",
    environment: "staging",
    projectId: "p1",
    evidence: { reauth: freshReauth() },
  });
  assert.equal(executing.status, "executing");
  const done = s.markExecuted(req.id, APPROVER.id, { rowsDeleted: 42 });
  assert.equal(done.status, "executed");
  // Second execution attempt against the same (now terminal) record fails.
  assert.throws(() =>
    assertDestructiveActionApproved(s, {
      requestId: req.id,
      principal: APPROVER,
      actionType: "delete_data",
      targetResourceType: "orders_table",
      targetResourceId: "orders_v1",
      environment: "staging",
      projectId: "p1",
      evidence: { reauth: freshReauth() },
    }),
  );
});

test("destructive: markFailed on execution error leaves a failed record", () => {
  const s = makeService();
  const req = s.request(REQUESTER, draft(), "corr-12");
  s.decide(APPROVER, req.id, "approve", "ok");
  assertDestructiveActionApproved(s, {
    requestId: req.id,
    principal: APPROVER,
    actionType: "delete_data",
    targetResourceType: "orders_table",
    targetResourceId: "orders_v1",
    environment: "staging",
    projectId: "p1",
    evidence: { reauth: freshReauth() },
  });
  const failed = s.markFailed(req.id, APPROVER.id, "disk IO error");
  assert.equal(failed.status, "failed");
});

test("destructive: approval replay against a different request id fails", () => {
  const s = makeService();
  const r1 = s.request(REQUESTER, draft(), "corr-13");
  s.decide(APPROVER, r1.id, "approve", "ok");
  // A second request is created, never approved.
  const r2 = s.request(
    REQUESTER,
    draft({ targetResourceId: "orders_v3" }),
    "corr-14",
  );
  assert.throws(() =>
    assertDestructiveActionApproved(s, {
      requestId: r2.id,
      principal: APPROVER,
      actionType: "delete_data",
      targetResourceType: "orders_table",
      targetResourceId: "orders_v3",
      environment: "staging",
      projectId: "p1",
    }),
  );
});

test("destructive: assertApproved fails CLOSED when no DestructiveApproverResolver is configured", () => {
  const s = makeService({ withResolver: false });
  const req = s.request(REQUESTER, draft(), "corr-fail-closed");
  s.decide(APPROVER, req.id, "approve", "ok");
  // Status is `approved` and every other precondition would pass — but
  // the executor cannot prove the approver is still an active,
  // authorized operator, so authorization must be refused.
  assert.throws(
    () =>
      assertDestructiveActionApproved(s, {
        requestId: req.id,
        principal: APPROVER,
        actionType: "delete_data",
        targetResourceType: "orders_table",
        targetResourceId: "orders_v1",
        environment: "staging",
        projectId: "p1",
        evidence: { reauth: freshReauth() },
      }),
    /authoritative approver revalidation unavailable/,
  );
  // And the request must NOT have transitioned to `executing`.
  assert.equal(s.get(req.id)?.status, "approved");
});
