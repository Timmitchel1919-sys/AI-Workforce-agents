/**
 * EO-6.2 — RULE-BASED Auditor foundation.
 *
 * Every finding comes from a fixed, deterministic rule over records the
 * platform already authoritatively holds (verifications, commits, releases,
 * sessions, usage) — the same reads the Spatial Graph and Operations use.
 * No model call is ever made to produce a finding: this is honestly
 * RULE-BASED, not model-assisted. A future model-assisted auditor is a
 * distinct capability this module does not claim.
 *
 * Pure and synchronous: findings are recomputed from whatever the caller
 * already fetched through an authorized, project-scoped read, on every call
 * — never persisted separately, so a fixed problem never lingers as stale
 * evidence the way a stored-and-forgotten finding would.
 */
import {
  riskAtLeast,
  type AuditFinding,
  type AuditRuleId,
  type AuditRunResult,
  type AuditSeverity,
  type CommitReceipt,
  type ExecutionSession,
  type ReleaseReceipt,
  type UsageRecord,
  type VerificationResult,
} from "../../contracts/index.js";
import type { AuditLog } from "../audit/audit-log.js";

export interface AuditInputs {
  releases: readonly ReleaseReceipt[];
  commits: readonly CommitReceipt[];
  verifications: readonly VerificationResult[];
  sessions: readonly ExecutionSession[];
  usage: readonly UsageRecord[];
}

type RawFinding = {
  ruleId: AuditRuleId;
  severity: AuditSeverity;
  subjectType: AuditFinding["subjectType"];
  subjectId: string;
  detail: string;
};
type Rule = (inputs: AuditInputs) => RawFinding[];

/** A simulated release is a VISUALIZATION, not a real deployment (ADR-0023) — never audited as one. */
const RULES: Readonly<Record<AuditRuleId, Rule>> = Object.freeze({
  release_without_verification: (inputs) => {
    const commitBySha = new Map(inputs.commits.map((c) => [c.commitSha, c]));
    const verificationById = new Map(inputs.verifications.map((v) => [v.verificationId, v]));
    const out: RawFinding[] = [];
    for (const r of inputs.releases) {
      if (r.simulated) continue;
      const commit = commitBySha.get(r.commitSha);
      const verification = commit ? verificationById.get(commit.verificationId) : undefined;
      if (!verification || verification.status !== "passed") {
        out.push({
          ruleId: "release_without_verification",
          severity: "critical",
          subjectType: "release",
          subjectId: r.releaseId,
          detail: verification
            ? `release ${r.releaseId} deployed commit ${r.commitSha.slice(0, 7)} whose verification ${verification.verificationId} did not pass (status: ${verification.status})`
            : `release ${r.releaseId} deployed commit ${r.commitSha.slice(0, 7)} with no matching passed verification on record`,
        });
      }
    }
    return out;
  },
  release_without_approval: (inputs) =>
    inputs.releases
      .filter((r) => !r.simulated && r.approvalIds.length === 0)
      .map((r) => ({
        ruleId: "release_without_approval" as const,
        severity: "critical" as const,
        subjectType: "release" as const,
        subjectId: r.releaseId,
        detail: `release ${r.releaseId} to ${r.targetClass} has no recorded approval`,
      })),
  high_risk_session_unapproved: (inputs) =>
    inputs.sessions
      .filter((s) => riskAtLeast(s.risk, "high") && s.approvalIds.length === 0)
      .map((s) => ({
        ruleId: "high_risk_session_unapproved" as const,
        severity: "warning" as const,
        subjectType: "session" as const,
        subjectId: s.sessionId,
        detail: `session ${s.sessionId} (${s.stageKind}) is ${s.risk} risk with no recorded approval`,
      })),
  usage_unpriced: (inputs) => {
    const unpriced = inputs.usage.filter((u) => !u.cost.priced);
    if (unpriced.length === 0) return [];
    const models = [...new Set(unpriced.map((u) => u.model))].sort();
    return [
      {
        ruleId: "usage_unpriced" as const,
        severity: "info" as const,
        subjectType: "usage" as const,
        subjectId: "unpriced-usage",
        detail: `${unpriced.length} usage record(s) could not be priced (model(s): ${models.join(", ")}); cost reporting for them is incomplete, not zero`,
      },
    ];
  },
});

export const AUDIT_RULE_IDS_LIST = Object.keys(RULES) as AuditRuleId[];

export class RuleAuditor {
  constructor(
    private readonly clock: () => string,
    private readonly audit?: AuditLog,
  ) {}

  /** Recomputes every rule fresh; nothing here is stored or cached. */
  run(projectId: string, inputs: AuditInputs): AuditRunResult {
    const generatedAt = this.clock();
    const findings: AuditFinding[] = [];
    for (const ruleId of AUDIT_RULE_IDS_LIST) {
      for (const raw of RULES[ruleId](inputs)) {
        findings.push({
          findingId: `${projectId}:${raw.ruleId}:${raw.subjectId}`,
          projectId,
          ruleId: raw.ruleId,
          severity: raw.severity,
          subjectType: raw.subjectType,
          subjectId: raw.subjectId,
          detail: raw.detail,
          createdAt: generatedAt,
        });
      }
    }
    for (const finding of findings) {
      this.audit?.record("audit_finding_raised", {
        projectId,
        data: { ruleId: finding.ruleId, severity: finding.severity, subjectType: finding.subjectType, subjectId: finding.subjectId },
      });
    }
    return { projectId, generatedAt, rulesRun: AUDIT_RULE_IDS_LIST, findings };
  }
}
