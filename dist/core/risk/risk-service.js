import { createId, now } from "../shared.js";
export class RiskService {
    risks = new Map();
    exceptions = new Map();
    vendors = new Map();
    createRisk(r) {
        const risk = {
            ...r,
            riskId: createId("risk"),
        };
        this.risks.set(risk.riskId, risk);
        return risk;
    }
    updateRisk(riskId, updates) {
        const r = this.risks.get(riskId);
        if (!r)
            throw new Error("Risk not found");
        Object.assign(r, updates);
        return r;
    }
    getRisks(orgId) {
        return Array.from(this.risks.values()).filter((r) => !orgId || r.organizationId === orgId);
    }
    createException(e) {
        const ex = {
            ...e,
            exceptionId: createId("ex"),
        };
        this.exceptions.set(ex.exceptionId, ex);
        return ex;
    }
    updateException(exceptionId, status, approvedBy) {
        const ex = this.exceptions.get(exceptionId);
        if (!ex)
            throw new Error("Exception not found");
        ex.status = status;
        if (status === "APPROVED" || status === "ACTIVE") {
            ex.approvedAt = now();
            if (approvedBy)
                ex.approvedBy = approvedBy;
            if (status === "ACTIVE") {
                // mark as active
            }
        }
        if (status === "EXPIRED" || status === "REVOKED") {
            if (status === "REVOKED")
                ex.revokedAt = now();
        }
        return ex;
    }
    getExceptions(orgId) {
        return Array.from(this.exceptions.values()).filter((e) => e.organizationId === orgId);
    }
    createVendor(v) {
        const vend = {
            ...v,
            vendorId: createId("vend"),
        };
        this.vendors.set(vend.vendorId, vend);
        return vend;
    }
    getVendors(orgId) {
        return Array.from(this.vendors.values()).filter((v) => !orgId || v.organizationId === orgId);
    }
}
