import { createId, now } from "../shared.js";
export class PolicyService {
    policies = new Map();
    acks = new Map();
    createPolicy(p) {
        const pol = {
            ...p,
            policyId: createId("pol"),
            version: p.version ?? 1,
            createdAt: now(),
            updatedAt: now(),
        };
        this.policies.set(pol.policyId, pol);
        return pol;
    }
    updatePolicy(policyId, updates) {
        const p = this.policies.get(policyId);
        if (!p)
            throw new Error("Policy not found");
        Object.assign(p, updates);
        p.updatedAt = now();
        return p;
    }
    newVersion(policyId, content, updatedBy) {
        const p = this.policies.get(policyId);
        if (!p)
            throw new Error("Policy not found");
        const newPol = {
            ...p,
            policyId: createId("pol"),
            version: p.version + 1,
            status: "DRAFT",
            content: content ?? p.content,
            supersedesPolicyId: p.policyId,
            createdAt: now(),
            updatedAt: now(),
            updatedBy: updatedBy ?? p.updatedBy,
        };
        this.policies.set(newPol.policyId, newPol);
        return newPol;
    }
    getPolicies(orgId) {
        return Array.from(this.policies.values()).filter(p => !orgId || p.organizationId === orgId);
    }
    acknowledge(policyId, principalId, policyVersion, orgId) {
        const ack = {
            ackId: createId("ack"),
            principalId,
            policyId,
            policyVersion,
            acknowledgedAt: now(),
            organizationId: orgId,
        };
        this.acks.set(ack.ackId, ack);
        return ack;
    }
    getAcknowledgements(policyId) {
        return Array.from(this.acks.values()).filter(a => a.policyId === policyId);
    }
}
