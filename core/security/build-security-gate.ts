import crypto from "node:crypto";
import type { Repository } from "../../contracts/persistence.js";
import type {
  BuildProvenance,
  SecurityCheckResult,
  SecurityFinding,
  SecurityGateResult,
} from "../../contracts/security-build.js";
import type { ZTNSecurityEvent } from "../../contracts/security.js";
import { SecurityExceptionStore } from "./security-exception-store.js";

export interface BuildSecurityGateOptions {
  exceptionStore?: SecurityExceptionStore;
  securityEvents?: Repository<ZTNSecurityEvent>;
  auditLog?: { log(event: string, meta?: Record<string, unknown>): void };
}

export interface GateEvaluationInput {
  environment: string;
  findings: readonly SecurityFinding[];
  checks: readonly SecurityCheckResult[];
  artifactContent?: string | Buffer;
  commitSha?: string;
  branch?: string;
}

/**
 * Deterministic Build Security Gate Service (Step 22).
 * Consumes scanner outputs, evaluates blocking rules, checks governed exceptions,
 * calculates artifact integrity, emits security events, and returns SecurityGateResult.
 */
export class BuildSecurityGateService {
  private readonly exceptionStore: SecurityExceptionStore;
  private readonly securityEvents?: Repository<ZTNSecurityEvent>;
  private readonly auditLog?: { log(event: string, meta?: Record<string, unknown>): void };

  constructor(options: BuildSecurityGateOptions = {}) {
    this.exceptionStore = options.exceptionStore ?? new SecurityExceptionStore();
    this.securityEvents = options.securityEvents;
    this.auditLog = options.auditLog;
  }

  async evaluateGate(input: GateEvaluationInput): Promise<SecurityGateResult> {
    const { environment, findings, checks, artifactContent, commitSha = "head", branch = "main" } = input;
    const now = new Date().toISOString();

    const blockingFindingIds: string[] = [];
    const activeFindings: SecurityFinding[] = [];

    // 1. Process findings and check active exceptions
    for (const finding of findings) {
      // Check for active exception
      const activeEx = await this.exceptionStore.findActiveExceptionForFinding(finding.id, environment);

      // Secret leaks & critical system invariants CANNOT be bypassed by exceptions
      if (finding.checkType === "secret_scan" && finding.severity === "critical") {
        blockingFindingIds.push(finding.id);
        activeFindings.push(finding);
        await this.emitSecurityEvent("secret_scan_failed", "critical", { ...finding });
        continue;
      }

      if (activeEx) {
        // Waived by approved, unexpired exception
        this.auditLog?.log("security_exception_applied", {
          findingId: finding.id,
          exceptionId: activeEx.id,
          environment,
        });
        continue;
      }

      if (finding.blocking) {
        blockingFindingIds.push(finding.id);
        activeFindings.push(finding);

        // Emit specific security events
        if (finding.checkType === "dependency_scan") {
          await this.emitSecurityEvent("dependency_vulnerability_detected", finding.severity, { ...finding });
        } else if (finding.checkType === "sast") {
          await this.emitSecurityEvent("sast_finding_detected", finding.severity, { ...finding });
        }
      }
    }

    // 2. Fail closed for production if mandatory scanners failed or were skipped
    const isProduction = environment === "production";
    const mandatoryChecks: SecurityCheckResult["checkType"][] = [
      "typecheck",
      "test",
      "secret_scan",
      "dependency_scan",
      "sast",
    ];

    if (isProduction) {
      for (const reqCheck of mandatoryChecks) {
        const checkRes = checks.find((c) => c.checkType === reqCheck);
        if (!checkRes || checkRes.status === "failed" || checkRes.status === "skipped" || checkRes.status === "unavailable") {
          const reason = `Mandatory scanner '${reqCheck}' ${checkRes ? checkRes.status : "missing"} for production deployment.`;
          blockingFindingIds.push(`MANDATORY_CHECK_FAILED_${reqCheck}`);
        }
      }
    }

    // 3. Artifact Hash Calculation
    let artifactHash: string | undefined;
    if (artifactContent) {
      artifactHash = crypto.createHash("sha256").update(artifactContent).digest("hex");
    }

    const allowed = blockingFindingIds.length === 0;
    const reason = allowed
      ? `Security gate PASSED for environment '${environment}'.`
      : `Security gate FAILED for environment '${environment}': ${blockingFindingIds.length} blocking security findings or failed mandatory checks.`;

    if (!allowed) {
      await this.emitSecurityEvent("security_gate_failed", isProduction ? "critical" : "high", {
        environment,
        blockingCount: blockingFindingIds.length,
        reason,
      });
    }

    const result: SecurityGateResult = {
      allowed,
      environment,
      findings: activeFindings,
      blockingFindings: blockingFindingIds,
      checks,
      reason,
      timestamp: now,
      artifactHash,
    };

    this.auditLog?.log("security_gate_evaluated", {
      allowed: result.allowed,
      environment: result.environment,
      blockingCount: blockingFindingIds.length,
    });

    return result;
  }

  async generateBuildProvenance(
    buildId: string,
    gateResult: SecurityGateResult,
    lockfileContent?: string
  ): Promise<BuildProvenance> {
    const lockfileHash = lockfileContent
      ? crypto.createHash("sha256").update(lockfileContent).digest("hex")
      : "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"; // Empty hash fallback

    return {
      buildId,
      repository: "Timmitchel1919-sys/AI-Workforce-agents",
      commitSha: process.env.GITHUB_SHA || "local-dev-sha",
      branch: process.env.GITHUB_REF_NAME || "main",
      lockfileHash,
      artifactHash: gateResult.artifactHash || "unhashed-artifact",
      checksPassed: gateResult.checks.filter((c) => c.status === "passed").map((c) => c.checkType),
      environment: gateResult.environment,
      builtAt: new Date().toISOString(),
    };
  }

  private async emitSecurityEvent(
    type: string,
    severity: string,
    details: Record<string, unknown>
  ): Promise<void> {
    if (!this.securityEvents) return;
    const id = `evt-sdlc-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const event: ZTNSecurityEvent = {
      id,
      eventId: id,
      eventType: "POLICY_VIOLATION",
      severity: severity.toUpperCase() as any,
      description: `SDLC Security Gate event [${type}]: ${JSON.stringify(details)}`,
      status: "OPEN",
      createdAt: new Date().toISOString(),
    };
    await this.securityEvents.upsert(event);
  }
}
