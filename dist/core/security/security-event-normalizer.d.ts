import type { CanonicalSecurityEvent, SecurityEventCategory, SecurityEventOutcome, SecurityEventSeverity } from "../../contracts/index.js";
/**
 * Hard upper bounds on evidence payloads. These exist so a careless
 * caller cannot write an unbounded blob into the append-only store.
 * The redactor TRUNCATES (and marks with `__truncated__`) rather than
 * refusing — losing an event is worse than losing part of it.
 */
export declare const SECURITY_EVENT_LIMITS: {
    readonly maxDepth: 6;
    readonly maxArrayItems: 64;
    readonly maxStringLength: 2048;
    readonly maxEvidenceKeys: 64;
};
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
