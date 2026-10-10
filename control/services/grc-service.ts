import type {
  ComplianceFramework,
  ControlInstance,
} from "../../contracts/compliance.js";
import type {
  EnterpriseRisk,
  ComplianceException,
  ThirdPartyVendor,
} from "../../contracts/risk.js";
import type {
  DataSubjectRequest,
  RetentionPolicy,
  DlpPolicy,
} from "../../contracts/privacy.js";
import type {
  CompliancePosture,
  AuditReadiness,
  AuditPackage,
  CertificationRecord,
  TrustCenterContent,
  ControlFinding,
} from "../../contracts/trust.js";
import type { Repository } from "../../contracts/persistence.js";
import type { OperatorPrincipal } from "../../contracts/control.js";
import { requireText, ValidationError } from "../../contracts/index.js";

export class GrcControlService {
  constructor(
    private readonly controls: Repository<any>,
    private readonly frameworks: Repository<any>,
    private readonly policies: Repository<any>,
    private readonly controlInstances: Repository<any>,
    private readonly risks: Repository<any>,
    private readonly exceptions: Repository<any>,
    private readonly vendors: Repository<any>,
    private readonly privacyRequests: Repository<any>,
    private readonly retentionPolicies: Repository<any>,
    private readonly dlpPolicies: Repository<any>,
    private readonly postures: Repository<any>,
    private readonly audits: Repository<any>,
    private readonly auditPackages: Repository<any>,
    private readonly certifications: Repository<any>,
    private readonly trustContent: Repository<any>,
    private readonly findings: Repository<any>
  ) {}

  private enforceComplianceAdmin(operator: OperatorPrincipal) {
    // Relying on standard tenant admin or specific compliance role if it existed
    if (operator.role !== "admin") {
      throw new ValidationError("Unauthorized. Requires admin role for GRC operations.");
    }
  }

  // --- COMPLIANCE ---
  async listFrameworks(): Promise<ComplianceFramework[]> {
    return this.frameworks.list();
  }

  async getCompliancePosture(organizationId: string): Promise<CompliancePosture[]> {
    return (await this.postures.list()).filter((p) => p.organizationId === organizationId);
  }

  // --- RISK ---
  async listRisks(organizationId: string): Promise<EnterpriseRisk[]> {
    return (await this.risks.list()).filter((r) => r.organizationId === organizationId);
  }

  async reportRisk(operator: OperatorPrincipal, risk: Omit<EnterpriseRisk, "riskId" | "status">): Promise<EnterpriseRisk> {
    this.enforceComplianceAdmin(operator);
    const newRisk: EnterpriseRisk = {
      ...risk,
      riskId: `risk_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      status: "IDENTIFIED",
    };
    this.risks.upsert(newRisk);
    return newRisk;
  }

  // --- PRIVACY ---
  async listDataSubjectRequests(organizationId: string): Promise<DataSubjectRequest[]> {
    return (await this.privacyRequests.list()).filter((r) => r.organizationId === organizationId);
  }

  async createDataSubjectRequest(operator: OperatorPrincipal, request: Omit<DataSubjectRequest, "requestId" | "status" | "receivedAt">): Promise<DataSubjectRequest> {
    this.enforceComplianceAdmin(operator);
    const newRequest: DataSubjectRequest = {
      ...request,
      requestId: `dsr_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      status: "PENDING",
      receivedAt: new Date().toISOString(),
    };
    this.privacyRequests.upsert(newRequest);
    return newRequest;
  }

  // --- TRUST CENTER ---
  async listTrustCenterContent(): Promise<TrustCenterContent[]> {
    return (await this.trustContent.list()).filter((c) => c.type === "PUBLIC" || c.type === "CUSTOMER");
  }

  async listCertifications(): Promise<CertificationRecord[]> {
    return this.certifications.list();
  }
}
