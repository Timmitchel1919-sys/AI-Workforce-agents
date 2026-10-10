import { ValidationError } from "../../contracts/index.js";
export class AuditControlService {
    auditLogs;
    findings;
    constructor(auditLogs, findings) {
        this.auditLogs = auditLogs;
        this.findings = findings;
    }
    enforceAdmin(operator) {
        if (operator.role !== "admin") {
            throw new ValidationError("Unauthorized. Requires admin role for Audit operations.");
        }
    }
    async listAuditLogs() {
        return this.auditLogs.list();
    }
    async logAction(entry) {
        const newEntry = {
            ...entry,
            id: `audit_${Date.now()}`,
            logId: `audit_${Date.now()}`,
            timestamp: new Date().toISOString(),
        };
        this.auditLogs.upsert(newEntry);
        return newEntry;
    }
    async listFindings() {
        return this.findings.list();
    }
}
