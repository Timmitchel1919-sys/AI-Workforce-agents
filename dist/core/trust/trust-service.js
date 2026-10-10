import { createId, now } from "../shared.js";
export class TrustService {
    postures = new Map();
    auditReadiness = new Map();
    auditPackages = new Map();
    certifications = new Map();
    trustContent = new Map();
    findings = new Map();
    createPosture(p) {
        const posture = {
            ...p,
            postureId: createId("post"),
            updatedAt: now(),
        };
        this.postures.set(posture.postureId, posture);
        return posture;
    }
    getPostures(orgId) {
        return Array.from(this.postures.values()).filter(p => p.organizationId === orgId);
    }
    updatePosture(postureId, updates) {
        const p = this.postures.get(postureId);
        if (!p)
            throw new Error("Posture not found");
        Object.assign(p, updates);
        p.updatedAt = now();
        return p;
    }
    setAuditReadiness(ar) {
        const ready = {
            ...ar,
            auditId: createId("audit"),
            updatedAt: now(),
        };
        this.auditReadiness.set(ready.auditId, ready);
        return ready;
    }
    createAuditPackage(ap) {
        const pkg = {
            ...ap,
            packageId: createId("pkg"),
        };
        this.auditPackages.set(pkg.packageId, pkg);
        return pkg;
    }
    addCertification(c) {
        const cert = {
            ...c,
            certificationId: createId("cert"),
        };
        this.certifications.set(cert.certificationId, cert);
        return cert;
    }
    getCertifications(orgId) {
        return Array.from(this.certifications.values()).filter(c => c.organizationId === orgId);
    }
    addTrustContent(tc) {
        const content = {
            ...tc,
            contentId: createId("tc"),
            updatedAt: now(),
        };
        this.trustContent.set(content.contentId, content);
        return content;
    }
    createFinding(f) {
        const finding = {
            ...f,
            findingId: createId("find"),
            createdAt: now(),
        };
        this.findings.set(finding.findingId, finding);
        return finding;
    }
    updateFinding(findingId, updates) {
        const f = this.findings.get(findingId);
        if (!f)
            throw new Error("Finding not found");
        Object.assign(f, updates);
        if (updates.status === "RESOLVED" && !f.resolvedAt)
            f.resolvedAt = now();
        if (updates.status === "ACCEPTED" && !f.acceptedAt)
            f.acceptedAt = now();
        if (updates.status === "FALSE_POSITIVE" && !f.falsePositiveAt)
            f.falsePositiveAt = now();
        return f;
    }
}
