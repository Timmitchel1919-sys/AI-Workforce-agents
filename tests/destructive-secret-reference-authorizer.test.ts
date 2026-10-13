import assert from "node:assert/strict";
import test from "node:test";
import type {
  ManagedSecretReference,
  OperatorPrincipal,
} from "../contracts/index.js";
import type { DestructiveActionService } from "../core/index.js";
import { DestructiveSecretReferenceMutationAuthorizer } from "../core/index.js";

const principal: OperatorPrincipal = {
  id: "admin",
  role: "admin",
  allowedProjects: "*",
};
const proposed: ManagedSecretReference = {
  id: "github-alpha",
  ref: "secret://github-alpha",
  provider: "gcp_secret_manager",
  providerResource: "projects/p/secrets/github-alpha",
  projectId: "alpha",
  purpose: "GitHub authentication",
  status: "active",
  version: 1,
  createdAt: "2026-10-13T00:00:00.000Z",
  createdBy: "admin",
  updatedAt: "2026-10-13T00:00:00.000Z",
  updatedBy: "admin",
};
const context = {
  correlationId: "corr-1",
  destructiveActionId: "dar-1",
  environment: "test" as const,
  evidence: {},
};

test("secret reference authorization rejects approval for another action", async () => {
  let assertions = 0;
  const destructive = {
    get: () => ({ action: "security_policy.mutate" }),
    assertApproved: () => {
      assertions += 1;
    },
  } as unknown as DestructiveActionService;
  const authorizer = new DestructiveSecretReferenceMutationAuthorizer(
    destructive,
  );
  await assert.rejects(
    () =>
      authorizer.authorize({
        principal,
        operation: "create",
        proposed,
        context,
      }),
    /not bound to secret\.reference\.create/,
  );
  assert.equal(assertions, 0);
});

test("secret reference authorization pins action, target, project and lifecycle", async () => {
  const calls: Array<{ kind: string; value: unknown }> = [];
  const destructive = {
    get: () => ({ action: "secret.reference.create" }),
    assertApproved: (value: unknown) => calls.push({ kind: "assert", value }),
    markExecuted: (...value: unknown[]) =>
      calls.push({ kind: "executed", value }),
    markFailed: (...value: unknown[]) => calls.push({ kind: "failed", value }),
  } as unknown as DestructiveActionService;
  const authorization = await new DestructiveSecretReferenceMutationAuthorizer(
    destructive,
  ).authorize({ principal, operation: "create", proposed, context });
  await authorization.complete?.();
  const assertion = calls[0]!.value as Record<string, unknown>;
  assert.equal(assertion.targetResourceType, "secret_reference");
  assert.equal(assertion.targetResourceId, "github-alpha");
  assert.equal(assertion.projectId, "alpha");
  assert.deepEqual(
    calls.map((call) => call.kind),
    ["assert", "executed"],
  );
});
