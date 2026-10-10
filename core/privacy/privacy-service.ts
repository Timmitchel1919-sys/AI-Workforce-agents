import { DataSubjectRequest, PrivacyRequest, RetentionPolicy } from "../../contracts/privacy.js";
import { createId, now } from "../shared.js";

export class PrivacyService {
  private requests = new Map<string, PrivacyRequest>();
  private retentionPolicies = new Map<string, RetentionPolicy[]>();

  submitPrivacyRequest(organizationId: string, email: string, type: PrivacyRequest["type"]): PrivacyRequest {
    const request: PrivacyRequest = {
      requestId: createId("dsr"),
      organizationId,
      requesterEmail: email,
      type,
      status: "PENDING",
      receivedAt: new Date(),
      identityVerified: false,
    } as PrivacyRequest;
    this.requests.set(request.requestId, request);
    return request;
  }

  getRequests(organizationId: string): PrivacyRequest[] {
    return Array.from(this.requests.values()).filter(r => r.organizationId === organizationId);
  }

  processRequest(requestId: string, status: "PROCESSING" | "COMPLETED" | "REJECTED" | "VERIFIED" | "IDENTITY_VERIFICATION_REQUIRED"): void {
    const req = this.requests.get(requestId);
    if (!req) throw new Error("Privacy request not found");
    req.status = status;
    if (status === "COMPLETED" || status === "REJECTED") {
      req.completedAt = new Date();
    }
    if (status === "VERIFIED") {
      req.verifiedAt = new Date();
      req.identityVerified = true;
    }
  }

  setRetentionPolicy(policy: RetentionPolicy): void {
    const list = this.retentionPolicies.get(policy.organizationId) || [];
    const existing = list.findIndex(p => p.dataType === policy.dataType);
    if (existing >= 0) {
      list[existing] = policy;
    } else {
      list.push(policy);
    }
    this.retentionPolicies.set(policy.organizationId, list);
  }

  getRetentionPolicies(organizationId: string): RetentionPolicy[] {
    return this.retentionPolicies.get(organizationId) || [];
  }
}
