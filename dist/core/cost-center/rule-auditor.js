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
import { riskAtLeast, } from "../../contracts/index.js";
/** A simulated release is a VISUALIZATION, not a real deployment (ADR-0023) — never audited as one. */
const RULES = Object.freeze({
    release_without_verification: (inputs) => {
        const commitBySha = new Map(inputs.commits.map((c) => [c.commitSha, c]));
        const verificationById = new Map(inputs.verifications.map((v) => [v.verificationId, v]));
        const out = [];
        for (const r of inputs.releases) {
            if (r.simulated)
                continue;
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
    release_without_approval: (inputs) => inputs.releases
        .filter((r) => !r.simulated && r.approvalIds.length === 0)
        .map((r) => ({
        ruleId: "release_without_approval",
        severity: "critical",
        subjectType: "release",
        subjectId: r.releaseId,
        detail: `release ${r.releaseId} to ${r.targetClass} has no recorded approval`,
    })),
    high_risk_session_unapproved: (inputs) => inputs.sessions
        .filter((s) => riskAtLeast(s.risk, "high") && s.approvalIds.length === 0)
        .map((s) => ({
        ruleId: "high_risk_session_unapproved",
        severity: "warning",
        subjectType: "session",
        subjectId: s.sessionId,
        detail: `session ${s.sessionId} (${s.stageKind}) is ${s.risk} risk with no recorded approval`,
    })),
    usage_unpriced: (inputs) => {
        const unpriced = inputs.usage.filter((u) => !u.cost.priced);
        if (unpriced.length === 0)
            return [];
        const models = [...new Set(unpriced.map((u) => u.model))].sort();
        return [
            {
                ruleId: "usage_unpriced",
                severity: "info",
                subjectType: "usage",
                subjectId: "unpriced-usage",
                detail: `${unpriced.length} usage record(s) could not be priced (model(s): ${models.join(", ")}); cost reporting for them is incomplete, not zero`,
            },
        ];
    },
});
export const AUDIT_RULE_IDS_LIST = Object.keys(RULES);
export class RuleAuditor {
    clock;
    audit;
    constructor(clock, audit) {
        this.clock = clock;
        this.audit = audit;
    }
    /** Recomputes every rule fresh; nothing here is stored or cached. */
    run(projectId, inputs) {
        const generatedAt = this.clock();
        const findings = [];
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
