/** A narrowly scoped, organization-owned rule for text data-loss prevention. */
export interface DlpRule {
    readonly target: string;
    readonly type: "REGEX";
    readonly pattern?: string;
}
export type DlpAction = "BLOCK" | "REDACT" | "WARN" | "AUDIT_ONLY";
export type DlpPolicyStatus = "ACTIVE" | "INACTIVE";
export interface DlpPolicy {
    readonly id: string;
    readonly organizationId: string;
    readonly status: DlpPolicyStatus;
    readonly action: DlpAction;
    readonly rules: readonly DlpRule[];
}
