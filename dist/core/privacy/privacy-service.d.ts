import { PrivacyRequest, RetentionPolicy } from "../../contracts/privacy.js";
export declare class PrivacyService {
    private requests;
    private retentionPolicies;
    submitPrivacyRequest(organizationId: string, email: string, type: PrivacyRequest["type"]): PrivacyRequest;
    getRequests(organizationId: string): PrivacyRequest[];
    processRequest(requestId: string, status: "PROCESSING" | "COMPLETED" | "REJECTED"): void;
    setRetentionPolicy(policy: RetentionPolicy): void;
    getRetentionPolicies(organizationId: string): RetentionPolicy[];
}
