import { describe, expect, test } from "vitest";
import type { BackupArtifact, BackupPolicy, NormalizedSecuritySignal } from "../contracts/secops.js";
import { BackupRecoveryService } from "../core/secops/backup-recovery-service.js";
import { SecurityResponseOrchestrator } from "../core/secops/security-response-orchestrator.js";
import { InMemoryRepository } from "../core/persistence/in-memory-repository.js";

describe("Layers 9-11 security foundations", () => {
  test("verifies immutable isolated backups and refuses unverified restore", async () => {
    const policies = new InMemoryRepository<BackupPolicy & { id: string }>();
    const artifacts = new InMemoryRepository<BackupArtifact & { id: string }>();
    policies.upsert({ id: "p1", policyId: "p1", organizationId: "org1", name: "daily", schedule: "daily", retentionDays: 30, immutable: true, isolated: true, enabled: true });
    let requested = "";
    const service = new BackupRecoveryService(policies, artifacts, {
      put: async ({ artifactId }) => `vault://${artifactId}`,
      verify: async () => true,
    }, { requestRestore: async (plan) => { requested = plan.artifactId; return "approval-1"; } });
    const artifact = await service.createArtifact("p1", { contentHash: "sha256:content", manifestHash: "sha256:manifest" });
    expect(artifact.status).toBe("VERIFIED");
    expect(await service.requestRestore({ restorePlanId: "r1", organizationId: "org1", artifactId: artifact.artifactId, targetEnvironment: "test", validationChecks: ["read-back"] })).toBe("approval-1");
    expect(requested).toBe(artifact.artifactId);
  });

  test("security agent remains advisory and routes high risk through the gate", () => {
    const requests: string[] = [];
    const orchestrator = new SecurityResponseOrchestrator({ id: "security-agent", capabilities: ["security.read"] }, { requestContainment: (_principal, id) => { requests.push(id); return "req-1"; } });
    const signal: NormalizedSecuritySignal = { signalId: "s1", organizationId: "org1", source: "API", kind: "suspicious-rate", actor: "user1", observedAt: new Date(), attributes: { rate: 20 } };
    const finding = orchestrator.evaluate(signal);
    expect(finding.riskScore).toBe(90);
    expect(orchestrator.respond({ id: "operator", role: "admin", capabilities: ["contain_security_threat"] } as never, finding).action).toBe("REQUEST_CONTAINMENT");
    expect(requests).toEqual([finding.findingId]);
  });

  test("rejects a privileged security-agent identity", () => {
    expect(() => new SecurityResponseOrchestrator({ id: "bad", capabilities: ["security.read", "admin"] }, { requestContainment: () => "x" })).toThrow(/too privileged/);
  });
});
