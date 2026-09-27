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
import { type AuditRuleId, type AuditRunResult, type CommitReceipt, type ExecutionSession, type ReleaseReceipt, type UsageRecord, type VerificationResult } from "../../contracts/index.js";
import type { AuditLog } from "../audit/audit-log.js";
export interface AuditInputs {
    releases: readonly ReleaseReceipt[];
    commits: readonly CommitReceipt[];
    verifications: readonly VerificationResult[];
    sessions: readonly ExecutionSession[];
    usage: readonly UsageRecord[];
}
export declare const AUDIT_RULE_IDS_LIST: AuditRuleId[];
export declare class RuleAuditor {
    private readonly clock;
    private readonly audit?;
    constructor(clock: () => string, audit?: AuditLog | undefined);
    /** Recomputes every rule fresh; nothing here is stored or cached. */
    run(projectId: string, inputs: AuditInputs): AuditRunResult;
}
