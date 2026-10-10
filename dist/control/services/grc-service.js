import { ValidationError } from "../../contracts/index.js";
export class GrcControlService {
    controls;
    frameworks;
    policies;
    controlInstances;
    risks;
    exceptions;
    vendors;
    privacyRequests;
    retentionPolicies;
    dlpPolicies;
    postures;
    audits;
    auditPackages;
    certifications;
    trustContent;
    findings;
    constructor(controls, frameworks, policies, controlInstances, risks, exceptions, vendors, privacyRequests, retentionPolicies, dlpPolicies, postures, audits, auditPackages, certifications, trustContent, findings) {
        this.controls = controls;
        this.frameworks = frameworks;
        this.policies = policies;
        this.controlInstances = controlInstances;
        this.risks = risks;
        this.exceptions = exceptions;
        this.vendors = vendors;
        this.privacyRequests = privacyRequests;
        this.retentionPolicies = retentionPolicies;
        this.dlpPolicies = dlpPolicies;
        this.postures = postures;
        this.audits = audits;
        this.auditPackages = auditPackages;
        this.certifications = certifications;
        this.trustContent = trustContent;
        this.findings = findings;
    }
    enforceComplianceAdmin(operator) {
        // Relying on standard tenant admin or specific compliance role if it existed
        if (operator.role !== "admin") {
            throw new ValidationError("Unauthorized. Requires admin role for GRC operations.");
        }
    }
    // --- COMPLIANCE ---
    async listFrameworks() {
        return this.frameworks.list();
    }
    async getCompliancePosture(organizationId) {
        return (await this.postures.list()).filter((p) => p.organizationId === organizationId);
    }
    // --- RISK ---
    async listRisks(organizationId) {
        return (await this.risks.list()).filter((r) => r.organizationId === organizationId);
    }
    async reportRisk(operator, risk) {
        this.enforceComplianceAdmin(operator);
        const newRisk = {
            ...risk,
            riskId: `risk_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
            status: "IDENTIFIED",
        };
        this.risks.upsert({ ...newRisk, id: newRisk.riskId });
        return newRisk;
    }
    // --- PRIVACY ---
    async listDataSubjectRequests(organizationId) {
        return (await this.privacyRequests.list()).filter((r) => r.organizationId === organizationId);
    }
    async createDataSubjectRequest(operator, request) {
        this.enforceComplianceAdmin(operator);
        const newRequest = {
            ...request,
            requestId: `dsr_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
            status: "PENDING",
            receivedAt: new Date().toISOString(),
        };
        this.privacyRequests.upsert({ ...newRequest, id: newRequest.requestId });
        return newRequest;
    }
    // --- TRUST CENTER ---
    async listTrustCenterContent() {
        return (await this.trustContent.list()).filter((c) => c.type === "PUBLIC" || c.type === "CUSTOMER");
    }
    async listCertifications() {
        return this.certifications.list();
    }
}
