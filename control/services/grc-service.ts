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
import type { Entity, Repository } from "../../contracts/persistence.js";
import type { OperatorPrincipal } from "../../contracts/control.js";
import { ValidationError } from "../../contracts/index.js";

type EntityRecord<T> = Entity & T;

export class GrcControlService {
  constructor(
    private readonly controls: Repository<EntityRecord<ControlInstance>>,
    private readonly frameworks: Repository<EntityRecord<ComplianceFramework>>,
    private readonly policies: Repository<EntityRecord<ComplianceFramework>>,
    private readonly controlInstances: Repository<
      EntityRecord<ControlInstance>
    >,
    private readonly risks: Repository<EntityRecord<EnterpriseRisk>>,
    private readonly exceptions: Repository<EntityRecord<ComplianceException>>,
    private readonly vendors: Repository<EntityRecord<ThirdPartyVendor>>,
    private readonly privacyRequests: Repository<
      EntityRecord<DataSubjectRequest>
    >,
    private readonly retentionPolicies: Repository<
      EntityRecord<RetentionPolicy>
    >,
    private readonly dlpPolicies: Repository<EntityRecord<DlpPolicy>>,
    private readonly postures: Repository<EntityRecord<CompliancePosture>>,
    private readonly audits: Repository<EntityRecord<AuditReadiness>>,
    private readonly auditPackages: Repository<EntityRecord<AuditPackage>>,
    private readonly certifications: Repository<
      EntityRecord<CertificationRecord>
    >,
    private readonly trustContent: Repository<EntityRecord<TrustCenterContent>>,
    private readonly findings: Repository<EntityRecord<ControlFinding>>,
  ) {}

  private enforceComplianceAdmin(operator: OperatorPrincipal) {
    // Relying on standard tenant admin or specific compliance role if it existed
    if (operator.role !== "admin") {
      throw new ValidationError(
        "Unauthorized. Requires admin role for GRC operations.",
      );
    }
  }

  // --- COMPLIANCE ---
  async listFrameworks(): Promise<ComplianceFramework[]> {
    return this.frameworks.list();
  }

  async getCompliancePosture(
    organizationId: string,
  ): Promise<CompliancePosture[]> {
    return (await this.postures.list()).filter(
      (p) => p.organizationId === organizationId,
    );
  }

  // --- RISK ---
  async listRisks(organizationId: string): Promise<EnterpriseRisk[]> {
    return (await this.risks.list()).filter(
      (r) => r.organizationId === organizationId,
    );
  }

  async reportRisk(
    operator: OperatorPrincipal,
    risk: Omit<EnterpriseRisk, "riskId" | "status">,
  ): Promise<EnterpriseRisk> {
    this.enforceComplianceAdmin(operator);
    const newRisk: EnterpriseRisk = {
      ...risk,
      riskId: `risk_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      status: "IDENTIFIED",
    };
    this.risks.upsert({ ...newRisk, id: newRisk.riskId });
    return newRisk;
  }

  // --- PRIVACY ---
  async listDataSubjectRequests(
    organizationId: string,
  ): Promise<DataSubjectRequest[]> {
    return (await this.privacyRequests.list()).filter(
      (r) => r.organizationId === organizationId,
    );
  }

  async createDataSubjectRequest(
    operator: OperatorPrincipal,
    request: Omit<DataSubjectRequest, "requestId" | "status" | "receivedAt">,
  ): Promise<DataSubjectRequest> {
    this.enforceComplianceAdmin(operator);
    const newRequest: DataSubjectRequest = {
      ...request,
      requestId: `dsr_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      status: "PENDING",
      receivedAt: new Date().toISOString(),
    };
    this.privacyRequests.upsert({ ...newRequest, id: newRequest.requestId });
    return newRequest;
  }

  // --- TRUST CENTER ---
  async listTrustCenterContent(): Promise<TrustCenterContent[]> {
    return (await this.trustContent.list()).filter(
      (c) => c.type === "PUBLIC" || c.type === "CUSTOMER",
    );
  }

  async listCertifications(): Promise<CertificationRecord[]> {
    return this.certifications.list();
  }
}
