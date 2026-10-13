import assert from "node:assert/strict";
import test from "node:test";
import type {
  ManagedSecretReference,
  OperatorPrincipal,
} from "../contracts/index.js";
import { InMemoryRepository, SecretReferenceService } from "../core/index.js";

const admin: OperatorPrincipal = {
  id: "admin",
  role: "admin",
  allowedProjects: ["alpha"],
};
const operator: OperatorPrincipal = {
  id: "operator",
  role: "operator",
  allowedProjects: ["alpha"],
};
const context = {
  correlationId: "corr-secret",
  destructiveActionId: "dar-secret",
  environment: "test" as const,
  evidence: {},
};
const draft = {
  ref: "secret://github-alpha" as const,
  provider: "gcp_secret_manager" as const,
  providerResource: "projects/p/secrets/github-alpha",
  projectId: "alpha",
  purpose: "GitHub repository authentication",
};

test("secret references: raw secret-shaped fields are structurally rejected", async () => {
  let authorizationCalls = 0;
  const service = new SecretReferenceService(
    new InMemoryRepository<ManagedSecretReference>(),
    {
      authorize: async () => {
        authorizationCalls += 1;
        return { authorized: true };
      },
    },
  );
  await assert.rejects(
    () =>
      service.create(
        admin,
        { ...draft, secret: "never" } as typeof draft,
        context,
      ),
    /raw secret material is never accepted/,
  );
  assert.equal(authorizationCalls, 0);
});

test("secret references: capability, project scope and authorizer all fail closed", async () => {
  const repository = new InMemoryRepository<ManagedSecretReference>();
  const service = new SecretReferenceService(repository, {
    authorize: async () => ({ authorized: true }),
  });
  await assert.rejects(
    () => service.create(operator, draft, context),
    /capability/,
  );
  await assert.rejects(
    () => service.create(admin, { ...draft, projectId: "beta" }, context),
    /no access/,
  );
  const noAuthorizer = new SecretReferenceService(repository);
  await assert.rejects(
    () => noAuthorizer.create(admin, draft, context),
    /authorizer unavailable/,
  );
});

test("secret references: create and update persist metadata only with immutable identity", async () => {
  const repository = new InMemoryRepository<ManagedSecretReference>();
  let completed = 0;
  const service = new SecretReferenceService(
    repository,
    {
      authorize: async () => ({
        authorized: true,
        complete: () => {
          completed += 1;
        },
      }),
    },
    () => "2026-10-13T00:00:00.000Z",
  );
  const created = await service.create(admin, draft, context);
  assert.equal(created.id, "github-alpha");
  assert.equal(created.version, 1);
  assert.equal(JSON.stringify(created).includes("never"), false);

  const updated = await service.update(
    admin,
    created.ref,
    { status: "rotation_required", purpose: "Rotate GitHub credential" },
    context,
  );
  assert.equal(updated.ref, created.ref);
  assert.equal(updated.provider, created.provider);
  assert.equal(updated.version, 2);
  assert.equal(updated.status, "rotation_required");
  assert.equal(completed, 2);
  assert.equal(service.list(admin).length, 1);
});

test("secret references: a durable write failure closes the destructive lifecycle", async () => {
  let failure = "";
  const repository = new InMemoryRepository<ManagedSecretReference>();
  repository.upsert = () => {
    throw new Error("vault metadata write failed");
  };
  const service = new SecretReferenceService(repository, {
    authorize: async () => ({
      authorized: true,
      fail: (reason) => {
        failure = reason;
      },
    }),
  });
  await assert.rejects(
    () => service.create(admin, draft, context),
    /write failed/,
  );
  assert.equal(failure, "vault metadata write failed");
});
