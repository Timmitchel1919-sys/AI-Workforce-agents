import assert from "node:assert/strict";
import test from "node:test";

import {
  DevelopmentEnvSecretProvider,
  GoogleSecretManagerProvider,
  SecretPolicyEngine,
  SecretReferenceStore,
  SecretValue,
  SecretVault,
  TestSecretProvider,
  redactObject,
  redactSecrets,
} from "../core/index.js";
import { SecretControlService } from "../control/index.js";
import type { SecretReference, SecretAccessRequest, ZTNSecurityEvent } from "../contracts/index.js";
import { InMemoryRepository } from "../core/persistence/in-memory-repository.js";

// Scenario 1: Retrieve valid development secret server-side
test("secrets: 1. retrieve valid development secret server-side", async () => {
  const provider = new DevelopmentEnvSecretProvider({
    env: { TEST_API_KEY: "secret-key-12345" },
    allowProductionEnvSecrets: true,
  });

  const ref: SecretReference = {
    id: "ref-1",
    provider: "env",
    kind: "api_key",
    scope: "project",
    secretName: "TEST_API_KEY",
    status: "active",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const secret = await provider.getSecret(ref);
  assert.equal(secret.reveal(), "secret-key-12345");
});

// Scenario 2: Missing development secret fails safely
test("secrets: 2. missing development secret fails safely", async () => {
  const provider = new DevelopmentEnvSecretProvider({ env: {} });
  const ref: SecretReference = {
    id: "missing-ref",
    provider: "env",
    kind: "api_key",
    scope: "global",
    secretName: "NON_EXISTENT_KEY",
    status: "active",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await assert.rejects(
    () => provider.getSecret(ref),
    (err: any) => err.code === "secret_not_found"
  );
});

// Scenario 3: Client / User attempts to retrieve raw secret -> DENIED
test("secrets: 3. client user attempts to retrieve raw secret is denied", async () => {
  const engine = new SecretPolicyEngine();
  const ref: SecretReference = {
    id: "ref-db",
    provider: "gcp_secret_manager",
    kind: "database_credential",
    scope: "project",
    projectId: "proj-alpha",
    secretName: "db_password",
    status: "active",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const request: SecretAccessRequest = {
    referenceId: "ref-db",
    actorId: "user-uid-1",
    actorType: "user", // Browser client / user
    projectId: "proj-alpha",
    purpose: "manage_secret_references",
    correlationId: "c1",
  };

  const decision = engine.evaluate({ request, reference: ref });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "browser_user_direct_secret_access_denied");
});

// Scenario 4: Unauthorized agent requests secret -> DENIED
test("secrets: 4. unauthorized agent requests secret is denied", async () => {
  const engine = new SecretPolicyEngine();
  const ref: SecretReference = {
    id: "ref-fin",
    provider: "gcp_secret_manager",
    kind: "integration_credential",
    scope: "project",
    projectId: "proj-alpha",
    secretName: "trading_key",
    status: "active",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const request: SecretAccessRequest = {
    referenceId: "ref-fin",
    actorId: "ui-designer-agent",
    actorType: "agent",
    projectId: "proj-alpha",
    purpose: "other" as any, // Invalid/unauthorized purpose
    correlationId: "c2",
  };

  const decision = engine.evaluate({ request, reference: ref });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "unauthorized_secret_access_purpose");
});

// Scenario 5: Agent requests secret outside project scope -> DENIED
test("secrets: 5. agent requests secret outside project scope is denied", async () => {
  const engine = new SecretPolicyEngine();
  const ref: SecretReference = {
    id: "ref-proj-a",
    provider: "test",
    kind: "api_key",
    scope: "project",
    projectId: "proj-alpha",
    secretName: "api_key",
    status: "active",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const request: SecretAccessRequest = {
    referenceId: "ref-proj-a",
    actorId: "agent-1",
    actorType: "agent",
    projectId: "proj-beta", // Wrong project
    purpose: "call_model_provider",
    correlationId: "c3",
  };

  const decision = engine.evaluate({ request, reference: ref, allowedProjects: ["proj-beta"] });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "project_scope_mismatch");
});

// Scenario 6: Correct tool/purpose requests scoped secret -> ALLOWED internally
test("secrets: 6. correct tool/purpose requests scoped secret is allowed internally", async () => {
  const testProvider = new TestSecretProvider({ "proj-key": "secret-payload-99" });
  const vault = new SecretVault({ providers: [testProvider] });

  const ref = await vault.getStore().createReference({
    id: "ref-scoped",
    provider: "test",
    kind: "model_provider_key",
    scope: "project",
    projectId: "proj-alpha",
    secretName: "proj-key",
  });

  const result = await vault.executeWithSecret(
    {
      referenceId: ref.id,
      actorId: "deployment-runner",
      actorType: "tool",
      projectId: "proj-alpha",
      purpose: "call_model_provider",
      correlationId: "c4",
    },
    async (secret) => {
      return `executed:${secret.reveal()}`;
    }
  );

  assert.equal(result, "executed:secret-payload-99");
});

// Scenario 7: Raw secret appears in audit event input -> REDACTED
test("secrets: 7. raw secret in input is redacted", () => {
  const secretKey = "sk-ant-api03-SECRET-KEY-MUST-BE-REDACTED";
  const logMessage = `Call failed for authorization header Bearer ${secretKey}`;

  const clean = redactSecrets(logMessage, [secretKey]).text;
  assert.ok(!clean.includes(secretKey));
  assert.match(clean, /\[redacted/i);

  const obj = redactObject({ name: "test", password: secretKey, key: secretKey });
  assert.equal(obj.password, "[REDACTED]");
});

// Scenario 8: Secret value returned in API response -> IMPOSSIBLE / REDACTED
test("secrets: 8. SecretValue toJSON and toString return redacted placeholder", () => {
  const secret = new SecretValue("super-secret-password-123");

  assert.equal(JSON.stringify(secret), '"[REDACTED_SECRET_VALUE]"');
  assert.equal(secret.toString(), "[REDACTED_SECRET_VALUE]");
  assert.ok(!Object.keys(secret).includes("_value"));
  assert.equal(secret.reveal(), "super-secret-password-123");
});

// Scenario 9: Secret reference update without capability -> DENIED
test("secrets: 9. secret reference update without capability is denied", async () => {
  const vault = new SecretVault();
  const service = new SecretControlService({ vault });

  const viewerPrincipal = {
    id: "viewer-1",
    role: "viewer" as const,
    allowedProjects: "*" as const,
    capabilities: ["view"] as const,
  };

  await assert.rejects(
    () => service.createReference(viewerPrincipal as any, {
      provider: "env",
      kind: "api_key",
      scope: "project",
      secretName: "KEY",
    }),
    /lacks capability/
  );
});

// Scenario 10 & 11: Secret rotation workflow & failed new credential validation
test("secrets: 10 & 11. secret rotation workflow keeps old credential if validation fails", async () => {
  const testProvider = new TestSecretProvider({ "api-secret": "old-v1-value" });
  const vault = new SecretVault({ providers: [testProvider] });

  const ref = await vault.getStore().createReference({
    id: "ref-rot",
    provider: "test",
    kind: "api_key",
    scope: "project",
    secretName: "api-secret",
    version: "1",
  });

  // Attempt rotation with invalid validator -> should throw and keep version 1 active
  await assert.rejects(
    () => vault.rotateSecret(ref.id, "bad-v2-value", "admin-1", "c-rot-1", async (_val) => false),
    (err: any) => err.code === "rotation_validation_failed"
  );

  const afterFail = await vault.getStore().getReference(ref.id);
  assert.equal(afterFail?.version, "1");

  // Attempt rotation with valid validator -> should succeed and update version
  const updated = await vault.rotateSecret(ref.id, "valid-v2-value", "admin-1", "c-rot-2", async (_val) => true);
  assert.equal(updated.version, "3"); // putSecret assigns next version number

  const resolved = await vault.executeWithSecret(
    {
      referenceId: ref.id,
      actorId: "system",
      actorType: "system",
      purpose: "call_model_provider",
      correlationId: "c-rot-3",
    },
    async (sec) => sec.reveal()
  );
  assert.equal(resolved, "valid-v2-value");
});

// Scenario 12: Possible exposure marks state compromised & emits security event
test("secrets: 12. possible exposure marks secret compromised and raises security event", async () => {
  const secEvents = new InMemoryRepository<ZTNSecurityEvent>();
  const vault = new SecretVault({ securityEvents: secEvents });

  const ref = await vault.getStore().createReference({
    id: "ref-leak",
    provider: "test",
    kind: "api_key",
    scope: "project",
    secretName: "leaked_key",
  });

  await vault.reportExposure(
    {
      referenceId: ref.id,
      reportedBy: "sec-auditor",
      evidence: "Key posted to public GitHub issue",
      exposureLevel: "CRITICAL",
      reportedAt: new Date().toISOString(),
    },
    "c-exp-1"
  );

  const updatedRef = await vault.getStore().getReference(ref.id);
  assert.equal(updatedRef?.status, "compromised");

  const events = await secEvents.list();
  assert.equal(events.length, 1);
  assert.equal(events[0].severity, "CRITICAL");
  assert.match(events[0].description, /compromised/);

  // Normal access request should be denied now
  const engine = new SecretPolicyEngine();
  const decision = engine.evaluate({
    request: {
      referenceId: ref.id,
      actorId: "agent-1",
      actorType: "agent",
      purpose: "call_model_provider",
      correlationId: "c-exp-2",
    },
    reference: updatedRef!,
  });

  assert.equal(decision.allowed, false);
  assert.match(decision.reason!, /compromised/);
});

// Scenario 13: Production uses development provider unexpectedly -> FAIL CLOSED
test("secrets: 13. production uses development provider unexpectedly fails closed", async () => {
  const envProvider = new DevelopmentEnvSecretProvider({
    env: { NODE_ENV: "production", LOCAL_KEY: "secret" },
    allowProductionEnvSecrets: false,
  });

  const ref: SecretReference = {
    id: "ref-prod-env",
    provider: "env",
    kind: "api_key",
    scope: "global",
    secretName: "LOCAL_KEY",
    status: "active",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await assert.rejects(
    () => envProvider.getSecret(ref),
    (err: any) => err.code === "env_provider_production_disallowed"
  );
});

// Scenario 14: Google Secret Manager provider error mapping
test("secrets: 14. GoogleSecretManagerProvider maps errors cleanly without leaking credentials", async () => {
  const gcpProvider = new GoogleSecretManagerProvider({
    gcpProjectId: "test-gcp-project",
    clientSeam: {
      accessSecretVersion: async () => {
        const err: any = new Error("Resource projects/test-gcp-project/secrets/missing/versions/latest not found");
        err.code = 5;
        throw err;
      },
    },
  });

  const ref: SecretReference = {
    id: "gcp-missing-ref",
    provider: "gcp_secret_manager",
    kind: "api_key",
    scope: "project",
    projectId: "test-gcp-project",
    secretName: "missing",
    status: "active",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await assert.rejects(
    () => gcpProvider.getSecret(ref),
    (err: any) => err.code === "secret_not_found"
  );
});
