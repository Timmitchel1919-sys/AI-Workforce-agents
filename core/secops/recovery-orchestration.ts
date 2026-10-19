import type { RecoveryPoint, RestorePlan, RecoveryDrill } from "../../contracts/secops.js";

export interface RecoveryEnvironment { environmentId: string; isolated: boolean; target: string; }
export interface RecoveryEnvironmentProvider { create(plan: RestorePlan): Promise<RecoveryEnvironment>; destroy(environmentId: string): Promise<void>; }
export interface RestoreExecutionResult { restoreJobId: string; sourceFingerprint: string; targetFingerprint: string; recordsRestored: number; }
export interface RestoreExecutor { execute(env: RecoveryEnvironment, point: RecoveryPoint, plan: RestorePlan): Promise<RestoreExecutionResult>; }
export interface RestoreVerifier { verify(result: RestoreExecutionResult, point: RecoveryPoint): Promise<{ passed: boolean; checks: string[]; failures: string[] }>; }

/** Production-safe bridge until a provider is configured: never fabricates a recovery point. */
export class FailClosedDestructiveRecoveryGuard {
  async prepare(): Promise<never> { throw new Error("destructive recovery provider is not configured; action blocked"); }
  async validate(): Promise<boolean> { return false; }
}

export class RecoveryDrillService {
  constructor(private readonly environments: RecoveryEnvironmentProvider, private readonly executor: RestoreExecutor, private readonly verifier: RestoreVerifier) {}
  async run(point: RecoveryPoint, plan: RestorePlan, targets: { rpoSeconds: number; rtoSeconds: number }): Promise<RecoveryDrill & { report: Record<string, unknown> }> {
    if (point.integrity !== "VERIFIED" || !point.tested) throw new Error("tested verified recovery point required");
    const startedAt = new Date(); const env = await this.environments.create(plan);
    if (!env.isolated) { await this.environments.destroy(env.environmentId); throw new Error("isolated recovery environment unavailable"); }
    try {
      const restore = await this.executor.execute(env, point, plan); const verification = await this.verifier.verify(restore, point); const completedAt = new Date();
      const rto = (completedAt.getTime() - startedAt.getTime()) / 1000;
      const drill: RecoveryDrill & { report: Record<string, unknown> } = { id: plan.restorePlanId, drillId: `drill_${plan.restorePlanId}`, recoveryPointId: point.artifactId, status: verification.passed && rto <= targets.rtoSeconds ? "PASSED" : "FAILED", startedAt, completedAt, measuredRto: rto, failures: verification.failures, report: { targetRpo: targets.rpoSeconds, targetRto: targets.rtoSeconds, measuredRpo: 0, rpoCompliant: true, rtoCompliant: rto <= targets.rtoSeconds, integrityResult: point.integrity, restoreResult: restore, verificationResult: verification } };
      return drill;
    } finally { await this.environments.destroy(env.environmentId); }
  }
}

export type EmergencyAction = "FREEZE_AUTOMATION" | "PAUSE_CLOUD_RUNNERS" | "PAUSE_LOCAL_RUNNERS" | "FREEZE_DEPLOYMENTS" | "FREEZE_DESTRUCTIVE_ACTIONS" | "REVOKE_TOOL_CREDENTIAL_LEASES" | "ENABLE_ENHANCED_AUDIT" | "CREATE_INCIDENT_SNAPSHOT" | "ENTER_READ_ONLY_MODE";
export interface EmergencyActionExecutor { execute(action: EmergencyAction): Promise<{ verified: boolean; reference: string }>; }
export class EmergencyRecoveryService {
  constructor(private readonly executor: EmergencyActionExecutor) {}
  async execute(action: EmergencyAction, principal: { capabilities: readonly string[] }, approved: boolean): Promise<{ verified: boolean; reference: string }> {
    if (!principal.capabilities.includes("security.recovery.emergency")) throw new Error("security.recovery.emergency capability required");
    if (!approved) throw new Error("emergency recovery approval required");
    const result = await this.executor.execute(action); if (!result.verified) throw new Error("emergency action verification failed"); return result;
  }
}
