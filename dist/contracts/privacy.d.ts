export interface DlpPolicy {
    policyId: string;
    organizationId: string;
    name: string;
    description: string;
    rules: DlpRule[];
    action: "BLOCK" | "REDACT" | "WARN" | "AUDIT_ONLY";
    status: "ACTIVE" | "INACTIVE";
}
export interface DlpRule {
    ruleId: string;
    type: "REGEX" | "KEYWORD" | "ML_CLASSIFIER";
    target: "CREDIT_CARD" | "SSN" | "API_KEY" | "CUSTOM";
    pattern?: string;
    matchThreshold: number;
}
export interface PrivacyRequest {
    requestId: string;
    organizationId: string;
    requesterEmail: string;
    type: "DATA_EXPORT" | "DATA_DELETION" | "CORRECTION";
    status: "PENDING" | "PROCESSING" | "COMPLETED" | "REJECTED";
    receivedAt: Date;
    completedAt?: Date;
}
export interface RetentionPolicy {
    policyId: string;
    organizationId: string;
    dataType: "AUDIT_LOGS" | "CHAT_HISTORY" | "EXECUTION_RECORDS" | "ALL";
    retentionDays: number;
    enforceDeletion: boolean;
}
