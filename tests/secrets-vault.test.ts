/**
 * Layer 7 — Secrets Management, Credential Vault & Key Rotation Tests
 */
import assert from "node:assert/strict";
import test from "node:test";
import { InMemorySecretVault } from "../adapters/vault/in-memory-secret-vault.js";
import { GoogleSecretManagerVault } from "../adapters/vault/google-secret-manager-vault.js";
import { SecretAccessService } from "../core/security/secret-access-service.js";
import { ToolCredentialBroker } from "../core/security/credential-broker.js";
import { SecretRotationService } from "../core/security/secret-rotation-service.js";
import { InMemoryRepository } from "../core/persistence/in-memory-repository.js";
import {
  InMemorySecurityPolicyStore,
  SecurityPolicyEngine,
} from "../core/security/security-policy-engine.js";
import type {
  AsyncSecurityEventStore,
  CanonicalSecurityEvent,
  ManagedSecretReference,
  OperatorPrincipal,
  SecretAccessContext,
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

const TEST_VIEWER: OperatorPrincipal = {
  id: "op-viewer-1",
  role: "viewer",
  allowedProjects: [],
};

test("InMemorySecretVault - stores, resolves and cleans leases safely", async () => {
  const vault = new InMemorySecretVault();
  const ref: ManagedSecretReference = {
    id: "sec-ref-1",
    ref: "secret://sec-ref-1",
    name: "GITHUB_TOKEN",
    provider: "in_memory_vault",
    providerResource: "gh_pat_key",
    purpose: "Testing secret lease",
    status: "active",
    version: 1,
    environment: "production",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: "admin",
    updatedBy: "admin",
  };

  vault.setSecret(ref.id, "super-secret-token-123");
  const context: SecretAccessContext = {
    principalId: TEST_ADMIN.id,
    principalType: "human",
    environment: "production",
    purpose: "Testing secret resolution",
    requestedAt: new Date().toISOString(),
    correlationId: "corr-1",
  };

  const lease = await vault.resolve(ref, context);
  assert.equal(lease.value, "super-secret-token-123");
  assert.equal(lease.version, "1");

  // Dispose scrub
  lease.dispose();
  assert.throws(() => lease.value, /disposed/i);

  const health = await vault.health();
  assert.equal(health.reachable, true);
  assert.equal(health.provider, "in_memory_vault");
});

test("GoogleSecretManagerVault - handles errors gracefully without crashing", async () => {
  const gsmVault = new GoogleSecretManagerVault({
    projectId: "test-gcp-project",
  });
  const health = await gsmVault.health();
  assert.equal(health.provider, "gcp_secret_manager");

  const ref: ManagedSecretReference = {
    id: "gsm-ref-1",
    ref: "secret://gsm-ref-1",
    name: "API_KEY",
    provider: "gcp_secret_manager",
    providerResource: "projects/test-gcp-project/secrets/my-secret",
    purpose: "GSM Integration",
    status: "active",
    version: 1,
    environment: "production",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: "admin",
    updatedBy: "admin",
  };

  const context: SecretAccessContext = {
    principalId: TEST_ADMIN.id,
    principalType: "human",
    environment: "production",
    purpose: "GSM Testing",
    requestedAt: new Date().toISOString(),
    correlationId: "corr-gsm-1",
  };

  await assert.rejects(async () => {
    await gsmVault.resolve(ref, context);
  }, /Google Cloud Secret Manager client/i);
});

test("SecretAccessService - enforces RBAC, environment and audit invariants", async () => {
  const vault = new InMemorySecretVault();
  const repo = new InMemoryRepository<ManagedSecretReference>();
  const eventStore = new TestSecurityEventStore();
  const service = new SecretAccessService({
    vault,
    repository: repo,
    securityEvents: eventStore,
  });

  const ref: ManagedSecretReference = {
    id: "sec-ref-prod",
    ref: "secret://sec-ref-prod",
    name: "STRIPE_KEY",
    provider: "in_memory_vault",
    providerResource: "stripe_prod_secret",
    purpose: "Stripe Billing",
    status: "active",
    version: 1,
    projectId: "proj-alpha",
    environment: "production",
    allowedConsumers: ["agent-payment"],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: "admin",
    updatedBy: "admin",
  };
  repo.upsert(ref);
  vault.setSecret(ref.id, "sk_live_stripe_999999");

  // 1. Viewer missing capability fails
  await assert.rejects(async () => {
    await service.resolve(TEST_VIEWER, "sec-ref-prod", {
      principalId: TEST_VIEWER.id,
      principalType: "human",
      environment: "production",
      purpose: "Payment",
      correlationId: "c-1",
      requestedAt: new Date().toISOString(),
    });
  }, /use_secret_reference or manage_secret_references capability required/i);

  // 2. Environment mismatch fails
  await assert.rejects(async () => {
    await service.resolve(TEST_ADMIN, "sec-ref-prod", {
      principalId: TEST_ADMIN.id,
      principalType: "human",
      environment: "staging",
      purpose: "Payment",
      correlationId: "c-2",
      requestedAt: new Date().toISOString(),
    });
  }, /Secret environment mismatch/i);

  await assert.rejects(async () => {
    await service.resolve(
      { id: "unauthorized-consumer", type: "agent" },
      "sec-ref-prod",
      {
        principalId: "unauthorized-consumer",
        principalType: "agent",
        environment: "production",
        purpose: "Payment",
        projectId: "proj-alpha",
        correlationId: "c-3",
        requestedAt: new Date().toISOString(),
      },
    );
  }, /Consumer 'unauthorized-consumer' is not authorized/i);

  // 4. Authorized resolution succeeds
  const lease = await service.resolve(
    { id: "agent-payment", type: "agent" },
    "sec-ref-prod",
    {
      principalId: "agent-payment",
      principalType: "agent",
      environment: "production",
      purpose: "Payment processing",
      projectId: "proj-alpha",
      correlationId: "c-4",
      requestedAt: new Date().toISOString(),
    },
  );
  assert.equal(lease.value, "sk_live_stripe_999999");
  lease.dispose();

  // 5. Verify security event logged with ZERO raw secrets
  assert.ok(eventStore.events.length > 0);
  const auditEvent = eventStore.events.find(
    (e) => e.type === "secret_access_granted",
  );
  assert.ok(auditEvent);
  const rawString = JSON.stringify(auditEvent);
  assert.equal(rawString.includes("sk_live_stripe_999999"), false);
});

test("ToolCredentialBroker - injects secret, executes, disposes and shields model", async () => {
  const vault = new InMemorySecretVault();
  const repo = new InMemoryRepository<ManagedSecretReference>();
  const service = new SecretAccessService({ vault, repository: repo });
  const broker = new ToolCredentialBroker(service);

  const ref: ManagedSecretReference = {
    id: "sec-tool",
    ref: "secret://sec-tool",
    name: "GITHUB_APP_KEY",
    provider: "in_memory_vault",
    providerResource: "gh_key",
    purpose: "GitHub Push",
    status: "active",
    version: 1,
    environment: "production",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: "admin",
    updatedBy: "admin",
  };
  repo.upsert(ref);
  vault.setSecret(ref.id, "ghp_tok_888888");

  let executedWithValue = "";
  const context: SecretAccessContext = {
    principalId: "agent-builder",
    principalType: "agent",
    environment: "production",
    purpose: "Tool invocation",
    correlationId: "broker-corr",
    requestedAt: new Date().toISOString(),
  };

  const result = await broker.executeWithSecret(
    context,
    ref,
    async (secretValue) => {
      executedWithValue = secretValue;
      return { status: "commit_pushed", sha: "abc1234" };
    },
  );

  assert.equal(executedWithValue, "ghp_tok_888888");
  assert.deepEqual(result, { status: "commit_pushed", sha: "abc1234" });
  assert.equal(JSON.stringify(result).includes("ghp_tok_888888"), false);
});

test("SecretRotationService - manages full rotation lifecycle and failsafe rollback", async () => {
  const vault = new InMemorySecretVault();
  const repo = new InMemoryRepository<ManagedSecretReference>();
  const eventStore = new TestSecurityEventStore();
  const policyStore = new InMemorySecurityPolicyStore([
    {
      id: "test-allow-secret-policy",
      name: "Allow secret policy in tests",
      enabled: true,
      actionPatterns: ["secret.*", "revoke.*"],
      risk: "low",
      effect: "allow",
      priority: 1,
      reason: "Allowed for tests",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ]);
  const policyEngine = new SecurityPolicyEngine(policyStore);

  const rotationService = new SecretRotationService({
    vault,
    repository: repo,
    policyEngine,
    securityEvents: eventStore,
  });

  const ref: ManagedSecretReference = {
    id: "sec-rot-test",
    ref: "secret://sec-rot-test",
    name: "DATABASE_PASSWORD",
    provider: "in_memory_vault",
    providerResource: "db_pass",
    purpose: "DB Access",
    status: "active",
    version: 1,
    environment: "production",
    rotationPolicy: {
      enabled: true,
      intervalDays: 30,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: "admin",
    updatedBy: "admin",
  };
  repo.upsert(ref);
  vault.setSecret(ref.id, "old-password-v1");

  const context: SecretAccessContext = {
    principalId: TEST_ADMIN.id,
    principalType: "human",
    environment: "production",
    purpose: "Rotation Execution",
    requestedAt: new Date().toISOString(),
    correlationId: "rot-corr-1",
  };

  // Rotate secret successfully
  const updatedRef = await rotationService.rotate(
    TEST_ADMIN,
    ref,
    "new-password-v2",
    context,
  );

  assert.equal(updatedRef.status, "active");
  assert.equal(updatedRef.version, 2);
  assert.ok(updatedRef.lastRotatedAt);
  assert.ok(updatedRef.rotationDueAt);

  // Check vault has updated value
  const resolved = await vault.resolve(updatedRef, context);
  assert.equal(resolved.value, "new-password-v2");
  resolved.dispose();

  // Emergency Revocation
  const revokedRef = await rotationService.emergencyRevoke(
    TEST_ADMIN,
    updatedRef,
    context,
  );
  assert.equal(revokedRef.status, "revoked");

  // Re-resolving revoked secret must fail in vault
  await assert.rejects(async () => {
    await vault.resolve(revokedRef, context);
  }, /Secret 'sec-rot-test' not found/i);
});
