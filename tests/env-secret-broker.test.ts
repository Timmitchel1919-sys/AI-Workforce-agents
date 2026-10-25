import assert from "node:assert/strict";
import test from "node:test";

import {
  EnvSecretBroker,
  envNameForSecret,
} from "../adapters/vault/env-secret-broker.js";
import type { CapabilityGrant, SecretReference } from "../contracts/index.js";

const REF = "secret://firebase-token" as SecretReference;

function grant(overrides: Partial<CapabilityGrant> = {}): CapabilityGrant {
  return {
    grantId: "grant-1",
    sessionId: "sess-1",
    projectId: "proj-1",
    agentId: "agent-1",
    environmentInstanceId: "env-1",
    workspaceId: "ws-1",
    toolId: "tool-1",
    operationId: "op-1",
    capability: "secret.reference.use",
    policyId: "pol",
    policyVersion: 1,
    issuedAt: "2026-10-17T00:00:00Z",
    expiresAt: "2026-10-17T01:00:00Z",
    ...overrides,
  };
}

test("envNameForSecret maps secret://name → AIW_SECRET_<NAME>", () => {
  assert.equal(envNameForSecret(REF), "AIW_SECRET_FIREBASE_TOKEN");
  assert.equal(
    envNameForSecret("secret://a.b-c" as SecretReference),
    "AIW_SECRET_A_B_C",
  );
});

test("describe() reports available iff the env var is present and non-empty", async () => {
  const broker = new EnvSecretBroker({
    env: () => ({ AIW_SECRET_FIREBASE_TOKEN: "the-token" }),
  });
  assert.deepEqual(await broker.describe(REF), { ref: REF, available: true });
  const empty = new EnvSecretBroker({
    env: () => ({ AIW_SECRET_FIREBASE_TOKEN: "" }),
  });
  assert.equal((await empty.describe(REF)).available, false);
  const missing = new EnvSecretBroker({ env: () => ({}) });
  assert.equal((await missing.describe(REF)).available, false);
});

test("issueHandle() refuses a grant without secret.reference.use", async () => {
  const broker = new EnvSecretBroker({
    env: () => ({ AIW_SECRET_FIREBASE_TOKEN: "the-token" }),
  });
  await assert.rejects(
    () =>
      broker.issueHandle(
        REF,
        grant({ capability: "filesystem.read" as never }),
      ),
    /secret\.reference\.use/,
  );
});

test("issueHandle() fails closed when the secret is missing", async () => {
  const broker = new EnvSecretBroker({ env: () => ({}) });
  await assert.rejects(
    () => broker.issueHandle(REF, grant()),
    /not configured/,
  );
});

test("issueHandle() returns a grant-bound opaque handle (never the value)", async () => {
  const broker = new EnvSecretBroker({
    env: () => ({ AIW_SECRET_FIREBASE_TOKEN: "the-token" }),
    handleKey: "fixed-test-key",
  });
  const h = await broker.issueHandle(REF, grant());
  assert.equal(h.ref, REF);
  assert.equal(h.grantId, "grant-1");
  assert.equal(h.expiresAt, "2026-10-17T01:00:00Z");
  assert.match(h.handleId, /^sh_[a-f0-9]{32}$/);
  // The handle is deterministic for the same (ref, grantId, handleKey) and
  // changes when the grant changes.
  const h2 = await broker.issueHandle(REF, grant());
  assert.equal(h.handleId, h2.handleId);
  const h3 = await broker.issueHandle(REF, grant({ grantId: "grant-2" }));
  assert.notEqual(h.handleId, h3.handleId);
  // Never leaks the raw value.
  assert.ok(!JSON.stringify(h).includes("the-token"));
});

test("resolve() returns the raw value only when available, else fails closed", async () => {
  const broker = new EnvSecretBroker({
    env: () => ({ AIW_SECRET_FIREBASE_TOKEN: "the-token" }),
  });
  assert.equal(await broker.resolve(REF), "the-token");
  const missing = new EnvSecretBroker({ env: () => ({}) });
  await assert.rejects(() => missing.resolve(REF), /not configured/);
});
