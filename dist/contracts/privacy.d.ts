export type DlpAction = "BLOCK" | "REDACT" | "WARN" | "AUDIT_ONLY";
export interface DlpPolicy {
    policyId: string;
    organizationId: string;
    name: string;
    description: string;
    rules: DlpRule[];
    action: DlpAction;
    status: "ACTIVE" | "INACTIVE";
}
export interface DlpRule {
    ruleId: string;
    type: "REGEX" | "KEYWORD" | "ML_CLASSIFIER";
    target: "CREDIT_CARD" | "SSN" | "API_KEY" | "CUSTOM";
    pattern?: string;
    matchThreshold: number;
}
export declare const DSR_TYPES: readonly ["ACCESS", "CORRECTION", "DELETION", "PORTABILITY", "RESTRICTION", "OBJECTION", "DATA_EXPORT"];
export type DsrType = (typeof DSR_TYPES)[number];
export declare const DSR_STATUSES: readonly ["PENDING", "PROCESSING", "COMPLETED", "REJECTED", "IDENTITY_VERIFICATION_REQUIRED", "VERIFIED", "WAITING", "CANCELLED", "IN_PROGRESS"];
export type DsrStatus = (typeof DSR_STATUSES)[number];
export interface DataSubjectRequest {
    requestId: string;
    organizationId: string;
    requesterEmail: string;
    requesterId?: string;
    type: DsrType;
    status: DsrStatus;
    receivedAt: Date | string;
    completedAt?: Date | string;
    verifiedAt?: Date | string;
    identityVerified: boolean;
    dataScope?: string;
    notes?: string;
    metadata?: Record<string, unknown>;
}
export type PrivacyRequest = DataSubjectRequest;
export interface RetentionPolicy {
    policyId: string;
    organizationId: string;
    dataType: "AUDIT_LOGS" | "CHAT_HISTORY" | "EXECUTION_RECORDS" | "ALL";
    retentionDays: number;
    enforceDeletion: boolean;
}
