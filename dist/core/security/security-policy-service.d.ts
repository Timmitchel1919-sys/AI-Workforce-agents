import { type SecurityActionContext, type SecurityPolicyDecision } from "../../contracts/security-policy.js";
import { SecurityPolicyEngine } from "./security-policy-engine.js";
import type { AuditLog } from "../audit/audit-log.js";
export declare class SecurityPolicyService {
    private readonly auditLog;
    private engine;
    constructor(auditLog: AuditLog, engine?: SecurityPolicyEngine);
    evaluate(context: SecurityActionContext): SecurityPolicyDecision;
    /**
     * Sanitizes metadata to ensure raw secrets or sensitive tokens are never audited.
     */
    private sanitizeMetadata;
}
