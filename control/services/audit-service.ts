import type { Repository } from "../../contracts/persistence.js";
import type { OperatorPrincipal } from "../../contracts/control.js";
import { ValidationError } from "../../contracts/index.js";
import type { AuditLogEntry, ComplianceFinding } from "../../contracts/audit.js";

export class AuditControlService {
  constructor(
    private readonly auditLogs: Repository<AuditLogEntry>,
    private readonly findings: Repository<ComplianceFinding>
  ) {}

  private enforceAdmin(operator: OperatorPrincipal) {
    if (operator.role !== "admin") {
      throw new ValidationError("Unauthorized. Requires admin role for Audit operations.");
    }
  }

  async listAuditLogs(): Promise<AuditLogEntry[]> {
    return this.auditLogs.list();
  }

  async logAction(entry: Omit<AuditLogEntry, "id" | "logId" | "timestamp">): Promise<AuditLogEntry> {
    const newEntry: AuditLogEntry = {
      ...entry,
      id: `audit_${Date.now()}`,
      logId: `audit_${Date.now()}`,
      timestamp: new Date().toISOString(),
    };
    this.auditLogs.upsert(newEntry);
    return newEntry;
  }

  async listFindings(): Promise<ComplianceFinding[]> {
    return this.findings.list();
  }
}
