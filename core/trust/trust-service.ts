import type {
  CompliancePosture,
  AuditReadiness,
  AuditPackage,
  CertificationRecord,
  TrustCenterContent,
  ControlFinding,
} from "../../contracts/trust.js";
import { createId, now } from "../shared.js";

export class TrustService {
  private postures = new Map<string, CompliancePosture>();
  private auditReadiness = new Map<string, AuditReadiness>();
  private auditPackages = new Map<string, AuditPackage>();
  private certifications = new Map<string, CertificationRecord>();
  private trustContent = new Map<string, TrustCenterContent>();
  private findings = new Map<string, ControlFinding>();

  createPosture(p: Omit<CompliancePosture, "postureId" | "updatedAt">): CompliancePosture {
    const posture: CompliancePosture = {
      ...p,
      postureId: createId("post"),
      updatedAt: now(),
    };
    this.postures.set(posture.postureId, posture);
    return posture;
  }

  getPostures(orgId: string): CompliancePosture[] {
    return Array.from(this.postures.values()).filter(p => p.organizationId === orgId);
  }

  updatePosture(postureId: string, updates: Partial<CompliancePosture>): CompliancePosture {
    const p = this.postures.get(postureId);
    if (!p) throw new Error("Posture not found");
    Object.assign(p, updates);
    p.updatedAt = now();
    return p;
  }

  setAuditReadiness(ar: Omit<AuditReadiness, "auditId" | "updatedAt">): AuditReadiness {
    const ready: AuditReadiness = {
      ...ar,
      auditId: createId("audit"),
      updatedAt: now(),
    };
    this.auditReadiness.set(ready.auditId, ready);
    return ready;
  }

  createAuditPackage(ap: Omit<AuditPackage, "packageId">): AuditPackage {
    const pkg: AuditPackage = {
      ...ap,
      packageId: createId("pkg"),
    };
    this.auditPackages.set(pkg.packageId, pkg);
    return pkg;
  }

  addCertification(c: Omit<CertificationRecord, "certificationId">): CertificationRecord {
    const cert: CertificationRecord = {
      ...c,
      certificationId: createId("cert"),
    };
    this.certifications.set(cert.certificationId, cert);
    return cert;
  }

  getCertifications(orgId: string): CertificationRecord[] {
    return Array.from(this.certifications.values()).filter(c => c.organizationId === orgId);
  }

  addTrustContent(tc: Omit<TrustCenterContent, "contentId" | "updatedAt">): TrustCenterContent {
    const content: TrustCenterContent = {
      ...tc,
      contentId: createId("tc"),
      updatedAt: now(),
    };
    this.trustContent.set(content.contentId, content);
    return content;
  }

  createFinding(f: Omit<ControlFinding, "findingId" | "createdAt">): ControlFinding {
    const finding: ControlFinding = {
      ...f,
      findingId: createId("find"),
      createdAt: now(),
    };
    this.findings.set(finding.findingId, finding);
    return finding;
  }

  updateFinding(findingId: string, updates: Partial<ControlFinding>): ControlFinding {
    const f = this.findings.get(findingId);
    if (!f) throw new Error("Finding not found");
    Object.assign(f, updates);
    if (updates.status === "RESOLVED" && !f.resolvedAt) f.resolvedAt = now();
    if (updates.status === "ACCEPTED" && !f.acceptedAt) f.acceptedAt = now();
    if (updates.status === "FALSE_POSITIVE" && !f.falsePositiveAt) f.falsePositiveAt = now();
    return f;
  }
}
