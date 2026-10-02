import type { CompliancePosture, AuditReadiness, AuditPackage, CertificationRecord, TrustCenterContent, ControlFinding } from "../../contracts/trust.js";
export declare class TrustService {
    private postures;
    private auditReadiness;
    private auditPackages;
    private certifications;
    private trustContent;
    private findings;
    createPosture(p: Omit<CompliancePosture, "postureId" | "updatedAt">): CompliancePosture;
    getPostures(orgId: string): CompliancePosture[];
    updatePosture(postureId: string, updates: Partial<CompliancePosture>): CompliancePosture;
    setAuditReadiness(ar: Omit<AuditReadiness, "auditId" | "updatedAt">): AuditReadiness;
    createAuditPackage(ap: Omit<AuditPackage, "packageId">): AuditPackage;
    addCertification(c: Omit<CertificationRecord, "certificationId">): CertificationRecord;
    getCertifications(orgId: string): CertificationRecord[];
    addTrustContent(tc: Omit<TrustCenterContent, "contentId" | "updatedAt">): TrustCenterContent;
    createFinding(f: Omit<ControlFinding, "findingId" | "createdAt">): ControlFinding;
    updateFinding(findingId: string, updates: Partial<ControlFinding>): ControlFinding;
}
