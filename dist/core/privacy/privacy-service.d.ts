import { PrivacyRequest, RetentionPolicy } from "../../contracts/privacy.js";
export declare class PrivacyService {
    private requests;
    private retentionPolicies;
    submitPrivacyRequest(organizationId: string, email: string, type: PrivacyRequest["type"]): PrivacyRequest;
    getRequests(organizationId: string): PrivacyRequest[];
    processRequest(requestId: string, status: "PROCESSING" | "COMPLETED" | "REJECTED" | "VERIFIED" | "IDENTITY_VERIFICATION_REQUIRED"): void;
    setRetentionPolicy(policy: RetentionPolicy): void;
    getRetentionPolicies(organizationId: string): RetentionPolicy[];
}
