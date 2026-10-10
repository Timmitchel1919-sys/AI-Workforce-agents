import type { CanonicalSecurityEvent, SecurityEventCategory, SecurityEventOutcome, SecurityEventSeverity } from "../../contracts/index.js";
export interface SecurityEventInput {
    eventId: string;
    occurredAt?: string;
    category: SecurityEventCategory;
    type: string;
    severity: SecurityEventSeverity;
    outcome: SecurityEventOutcome;
    actor: CanonicalSecurityEvent["actor"];
    source: CanonicalSecurityEvent["source"];
    target?: CanonicalSecurityEvent["target"];
    projectId?: string;
    correlationId?: string;
    approvalId?: string;
    policyId?: string;
    evidence?: Readonly<Record<string, unknown>>;
}
export declare function normalizeSecurityEvent(input: SecurityEventInput): CanonicalSecurityEvent;
