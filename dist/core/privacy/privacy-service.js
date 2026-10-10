import { createId } from "../shared.js";
export class PrivacyService {
    requests = new Map();
    retentionPolicies = new Map();
    submitPrivacyRequest(organizationId, email, type) {
        const request = {
            requestId: createId("dsr"),
            organizationId,
            requesterEmail: email,
            type,
            status: "PENDING",
            receivedAt: new Date(),
            identityVerified: false,
        };
        this.requests.set(request.requestId, request);
        return request;
    }
    getRequests(organizationId) {
        return Array.from(this.requests.values()).filter((r) => r.organizationId === organizationId);
    }
    processRequest(requestId, status) {
        const req = this.requests.get(requestId);
        if (!req)
            throw new Error("Privacy request not found");
        req.status = status;
        if (status === "COMPLETED" || status === "REJECTED") {
            req.completedAt = new Date();
        }
        if (status === "VERIFIED") {
            req.verifiedAt = new Date();
            req.identityVerified = true;
        }
    }
    setRetentionPolicy(policy) {
        const list = this.retentionPolicies.get(policy.organizationId) || [];
        const existing = list.findIndex((p) => p.dataType === policy.dataType);
        if (existing >= 0) {
            list[existing] = policy;
        }
        else {
            list.push(policy);
        }
        this.retentionPolicies.set(policy.organizationId, list);
    }
    getRetentionPolicies(organizationId) {
        return this.retentionPolicies.get(organizationId) || [];
    }
}
