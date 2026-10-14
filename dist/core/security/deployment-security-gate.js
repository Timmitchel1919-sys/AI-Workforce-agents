import { PermissionDeniedError, operatorCan, } from "../../contracts/index.js";
import { normalizeSecurityEvent } from "./security-event-normalizer.js";
export class DeploymentSecurityGate {
    findingStore;
    policyEngine;
    securityEvents;
    clock;
    constructor(findingStore, policyEngine, securityEvents, clock = () => new Date().toISOString()) {
        this.findingStore = findingStore;
        this.policyEngine = policyEngine;
        this.securityEvents = securityEvents;
        this.clock = clock;
    }
    evaluateDeployment(environment, projectId, override) {
        const openFindings = this.findingStore.list({ status: "open", projectId });
        // Identify blocking findings:
        // 1. Any confirmed secret leak
        // 2. Any critical SAST finding
        // 3. Any critical dependency vulnerability
        // 4. In production: also high severity findings unless overridden
        const blockingFindings = openFindings.filter((f) => {
            if (f.category === "secret_leak")
                return true;
            if (f.severity === "critical")
                return true;
            if (environment === "production" && f.severity === "high")
                return true;
            return false;
        });
        if (blockingFindings.length === 0) {
            return {
                allowed: true,
                blockedFindings: [],
                reason: "DEPLOYMENT_SECURITY_GATE_PASSED: no blocking security findings",
            };
        }
        // Check governed emergency override
        if (override) {
            const nowMs = Date.parse(this.clock());
            const expiryMs = Date.parse(override.expiresAt);
            if (Number.isNaN(expiryMs) || expiryMs <= nowMs) {
                throw new PermissionDeniedError("Emergency security override has expired or is invalid");
            }
            if (!operatorCan(override.principal, "manage_security_policy")) {
                throw new PermissionDeniedError("manage_security_policy capability required to grant security override");
            }
            if (!override.justification ||
                override.justification.trim().length < 10) {
                throw new PermissionDeniedError("A detailed written justification (min 10 chars) is required for emergency override");
            }
            if (environment === "production" &&
                (!override.reauthVerified || !override.mfaVerified)) {
                throw new PermissionDeniedError("Production security override requires verified reauthentication and MFA");
            }
            // Check all blocking findings are explicitly listed in the override
            const allCovered = blockingFindings.every((f) => override.findingIds.includes(f.id));
            if (!allCovered) {
                const uncovered = blockingFindings.filter((f) => !override.findingIds.includes(f.id));
                return {
                    allowed: false,
                    blockedFindings: uncovered,
                    reason: `DEPLOYMENT_GATE_BLOCKED: ${uncovered.length} blocking finding(s) not covered by override`,
                };
            }
            this.recordEvent("security_override_applied", "allowed", {
                operatorId: override.principal.id,
                findingIds: override.findingIds,
                justification: override.justification,
                expiresAt: override.expiresAt,
                environment,
            });
            return {
                allowed: true,
                blockedFindings: [],
                reason: `DEPLOYMENT_SECURITY_GATE_OVERRIDDEN: ${override.justification}`,
                overrideApplied: true,
            };
        }
        this.recordEvent("supply_chain_policy_denied", "denied", {
            blockingCount: blockingFindings.length,
            findingIds: blockingFindings.map((f) => f.id),
            environment,
        });
        return {
            allowed: false,
            blockedFindings: blockingFindings,
            reason: `DEPLOYMENT_GATE_BLOCKED: ${blockingFindings.length} open security finding(s) require remediation before deployment`,
        };
    }
    recordEvent(type, outcome, evidence) {
        if (!this.securityEvents)
            return;
        try {
            this.securityEvents.append(normalizeSecurityEvent({
                eventId: `sec-gate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                occurredAt: this.clock(),
                category: "deployment",
                type,
                severity: outcome === "allowed" ? "medium" : "critical",
                outcome,
                actor: { kind: "system" },
                source: { kind: "deployment_security_gate" },
                evidence: Object.freeze(evidence),
            }));
        }
        catch {
            // Non-blocking for audit event failures
        }
    }
}
