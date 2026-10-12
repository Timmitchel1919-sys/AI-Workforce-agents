import { validateSecurityActionContext } from "../../contracts/security-policy.js";
import { SecurityPolicyEngine } from "./security-policy-engine.js";
import { randomUUID } from "node:crypto";
export class SecurityPolicyService {
    auditLog;
    engine;
    constructor(auditLog, engine) {
        this.auditLog = auditLog;
        this.engine = engine ?? new SecurityPolicyEngine();
    }
    evaluate(context) {
        validateSecurityActionContext(context);
        // Evaluate via the deterministic engine
        const decision = this.engine.evaluate(context);
        // Step 9: Audit high-value policy decisions
        // We log denials, high/critical risk actions, or actions that require approval
        if (!decision.allowed || decision.risk === "high" || decision.risk === "critical" || decision.requiresApproval) {
            const sanitizedMetadata = this.sanitizeMetadata(context.metadata);
            this.auditLog.record("security_policy_decision", {
                projectId: context.projectId,
                data: {
                    correlationId: context.correlationId || randomUUID(),
                    actor: context.actorId,
                    action: context.action,
                    targetType: context.targetResourceType,
                    targetId: context.targetResourceId,
                    risk: decision.risk,
                    allowed: decision.allowed,
                    requiresApproval: decision.requiresApproval,
                    requiresReauthentication: decision.requiresReauthentication,
                    requiresMfa: decision.requiresMfa,
                    matchedPolicyIds: decision.matchedPolicyIds,
                    reason: decision.reason,
                    metadata: sanitizedMetadata,
                },
            });
        }
        return decision;
    }
    /**
     * Sanitizes metadata to ensure raw secrets or sensitive tokens are never audited.
     */
    sanitizeMetadata(metadata) {
        if (!metadata)
            return {};
        const sanitized = { ...metadata };
        const SENSITIVE_KEYS = ["password", "token", "secret", "private_key", "credential", "key"];
        for (const key of Object.keys(sanitized)) {
            if (SENSITIVE_KEYS.some((k) => key.toLowerCase().includes(k))) {
                sanitized[key] = "[REDACTED]";
            }
            else if (typeof sanitized[key] === "object" && sanitized[key] !== null) {
                sanitized[key] = "[COMPLEX_OBJECT]";
            }
        }
        return sanitized;
    }
}
