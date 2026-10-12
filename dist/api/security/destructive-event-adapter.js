/**
 * `DestructiveActionObserver` adapter that translates the Layer-3
 * service's safe lifecycle signals into canonical, append-only
 * `CanonicalSecurityEvent` records in Layer-4's store. The service
 * never persists raw request bodies; this adapter only forwards the
 * already-safe event fields (ids, correlation, reason strings
 * authored by the service).
 */
import { randomUUID } from "node:crypto";
import { normalizeSecurityEvent } from "../../core/security/security-event-normalizer.js";
import { SECURITY_EVENT_TYPES, } from "../../contracts/security-event.js";
const EVENT_MAP = {
    destructive_action_revision_created: {
        type: "destructive_action_revision_created",
        category: "destructive_action",
        severity: "info",
        outcome: "observed",
    },
    destructive_action_approvals_invalidated: {
        type: "destructive_action_approvals_invalidated",
        category: "destructive_action",
        severity: "medium",
        outcome: "escalated",
    },
    destructive_action_approver_no_longer_authorized: {
        type: "destructive_action_bypass_attempt",
        category: "destructive_action",
        severity: "high",
        outcome: "blocked",
    },
    destructive_action_policy_drift_detected: {
        type: "security_policy_denied",
        category: "destructive_action",
        severity: "high",
        outcome: "escalated",
    },
    destructive_action_reapproval_required: {
        type: "security_policy_approval_required",
        category: "destructive_action",
        severity: "medium",
        outcome: "pending",
    },
    destructive_action_mfa_required: {
        type: "destructive_action_approval_required",
        category: "destructive_action",
        severity: "medium",
        outcome: "pending",
    },
    destructive_action_reauthentication_required: {
        type: "destructive_action_approval_required",
        category: "destructive_action",
        severity: "medium",
        outcome: "pending",
    },
    destructive_action_execution_revalidated: {
        type: SECURITY_EVENT_TYPES.DESTRUCTIVE_EXECUTION_STARTED,
        category: "destructive_action",
        severity: "info",
        outcome: "observed",
    },
    destructive_action_execution_blocked: {
        type: SECURITY_EVENT_TYPES.DESTRUCTIVE_BLOCKED,
        category: "destructive_action",
        severity: "high",
        outcome: "blocked",
    },
};
/**
 * Build an observer that writes safe, bounded canonical security
 * events whenever the destructive-action service emits a lifecycle
 * signal. The composition root is responsible for passing a durable
 * store; in-memory stores are fine for development.
 */
export function createDestructiveSecurityEventObserver(store) {
    const write = async (event) => {
        const normalized = normalizeSecurityEvent(event);
        const result = store.append(normalized);
        if (result && typeof result.then === "function") {
            await result;
        }
    };
    return {
        onSecurityEvent(event) {
            const mapping = EVENT_MAP[event.kind];
            // Only safe, operator-facing evidence fields.
            const evidence = {
                kind: event.kind,
                requestId: event.requestId,
            };
            if ("operatorId" in event)
                evidence.operatorId = event.operatorId;
            if ("revision" in event)
                evidence.revision = event.revision;
            if ("previousRevision" in event)
                evidence.previousRevision = event.previousRevision;
            if ("stricter" in event)
                evidence.stricter = event.stricter;
            if ("reason" in event)
                evidence.reason = event.reason;
            // Fire-and-forget: the service must never block on event
            // persistence, but an awaited promise is still awaited so test
            // runs stay deterministic.
            void write({
                eventId: `sec_${event.requestId}_${randomUUID()}`,
                category: mapping.category,
                type: mapping.type,
                severity: mapping.severity,
                outcome: mapping.outcome,
                actor: { kind: "system", id: "destructive-action-service" },
                source: { kind: "control-plane", id: "destructive-action-service" },
                target: { kind: "destructive_action", id: event.requestId },
                correlationId: event.correlationId,
                evidence,
            });
        },
    };
}
