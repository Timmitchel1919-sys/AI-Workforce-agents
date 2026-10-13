import assert from "node:assert/strict";
import test from "node:test";
import type { OperatorPrincipal, SecurityPolicy } from "../contracts/index.js";
import {
  DestructiveSecurityPolicyMutationAuthorizer,
  InMemoryRepository,
  SecurityPolicyService,
  defaultSecurityPolicies,
} from "../core/index.js";
import type { DestructiveActionService } from "../core/index.js";

const admin: OperatorPrincipal = {
  id: "admin",
  role: "admin",
  allowedProjects: "*",
};
const viewer: OperatorPrincipal = {
  id: "viewer",
  role: "viewer",
  allowedProjects: "*",
};
const policy = defaultSecurityPolicies(() => "2026-10-13T00:00:00.000Z")[0]!;

test("security policy service: reads require view_security and are priority ordered", () => {
  const repository = new InMemoryRepository<SecurityPolicy>();
  repository.upsert({ ...policy, id: "sec.z.second", priority: 200 });
  repository.upsert(policy);
  const service = new SecurityPolicyService(repository);

  assert.deepEqual(
    service.list(viewer).map((item) => item.id),
    [policy.id, "sec.z.second"],
  );
});

test("security policy service: mutation fails closed without a trusted authorizer", async () => {
  const service = new SecurityPolicyService(
    new InMemoryRepository<SecurityPolicy>(),
  );
  await assert.rejects(
    () =>
      service.upsert(admin, policy, {
        correlationId: "corr-1",
        destructiveActionId: "dar-1",
        environment: "test",
        evidence: {},
      }),
    /authorizer unavailable/,
  );
});

test("security policy service: capability and authorizer are both mandatory", async () => {
  let calls = 0;
  const repository = new InMemoryRepository<SecurityPolicy>();
  const service = new SecurityPolicyService(repository, {
    authorize: async () => {
      calls += 1;
      return { authorized: true, approvalId: "approval-1" };
    },
  });

  await assert.rejects(
    () =>
      service.upsert(viewer, policy, {
        correlationId: "corr-1",
        destructiveActionId: "dar-1",
        environment: "test",
        evidence: {},
      }),
    /manage_security_policy/,
  );
  assert.equal(calls, 0);
  await service.upsert(admin, policy, {
    correlationId: "corr-2",
    destructiveActionId: "dar-1",
    environment: "test",
    evidence: {},
  });
  assert.equal(calls, 1);
  assert.equal(repository.findById(policy.id)?.id, policy.id);
});

test("security policy service: invalid policy never reaches the authorizer", async () => {
  let calls = 0;
  const service = new SecurityPolicyService(
    new InMemoryRepository<SecurityPolicy>(),
    {
      authorize: async () => {
        calls += 1;
        return { authorized: true };
      },
    },
  );
  await assert.rejects(
    () =>
      service.upsert(
        admin,
        { ...policy, id: "../escape" },
        {
          correlationId: "corr-1",
          destructiveActionId: "dar-1",
          environment: "test",
          evidence: {},
        },
      ),
    /invalid security policy id/,
  );
  assert.equal(calls, 0);
});

test("destructive policy authorizer pins the target and closes the execution lifecycle", async () => {
  const calls: Array<{ kind: string; value: unknown }> = [];
  const destructive = {
    get: () => ({ action: "security_policy.mutate" }),
    assertApproved: (value: unknown) => calls.push({ kind: "assert", value }),
    markExecuted: (...value: unknown[]) =>
      calls.push({ kind: "executed", value }),
    markFailed: (...value: unknown[]) => calls.push({ kind: "failed", value }),
  } as unknown as DestructiveActionService;
  const repository = new InMemoryRepository<SecurityPolicy>();
  const service = new SecurityPolicyService(
    repository,
    new DestructiveSecurityPolicyMutationAuthorizer(destructive),
  );

  await service.upsert(admin, policy, {
    correlationId: "corr-bound",
    destructiveActionId: "dar-bound",
    environment: "production",
    evidence: {
      mfa: {
        verified: true,
        verifiedAt: new Date().toISOString(),
        method: "totp",
      },
      reauth: {
        verified: true,
        verifiedAt: new Date().toISOString(),
        method: "firebase",
      },
    },
  });

  const assertion = calls[0]!.value as Record<string, unknown>;
  assert.equal(assertion.requestId, "dar-bound");
  assert.equal(assertion.actionType, "other_destructive");
  assert.equal(assertion.targetResourceType, "security_policy");
  assert.equal(assertion.targetResourceId, policy.id);
  assert.equal(assertion.environment, "production");
  assert.deepEqual(
    calls.map((call) => call.kind),
    ["assert", "executed"],
  );
});

test("security policy service marks an authorized destructive mutation failed when persistence throws", async () => {
  let failedReason = "";
  const repository = new InMemoryRepository<SecurityPolicy>();
  repository.upsert = () => {
    throw new Error("durable write failed");
  };
  const service = new SecurityPolicyService(repository, {
    authorize: async () => ({
      authorized: true,
      fail: (reason) => {
        failedReason = reason;
      },
    }),
  });

  await assert.rejects(
    () =>
      service.upsert(admin, policy, {
        correlationId: "corr-fail",
        destructiveActionId: "dar-fail",
        environment: "test",
        evidence: {},
      }),
    /durable write failed/,
  );
  assert.equal(failedReason, "durable write failed");
});
