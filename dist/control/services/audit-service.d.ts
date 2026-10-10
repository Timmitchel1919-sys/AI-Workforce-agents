import type { Repository } from "../../contracts/persistence.js";
import type { AuditLogEntry, ComplianceFinding } from "../../contracts/audit.js";
export declare class AuditControlService {
    private readonly auditLogs;
    private readonly findings;
    constructor(auditLogs: Repository<AuditLogEntry>, findings: Repository<ComplianceFinding>);
    private enforceAdmin;
    listAuditLogs(): Promise<AuditLogEntry[]>;
    logAction(entry: Omit<AuditLogEntry, "id" | "logId" | "timestamp">): Promise<AuditLogEntry>;
    listFindings(): Promise<ComplianceFinding[]>;
}
