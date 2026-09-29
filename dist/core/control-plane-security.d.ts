export declare class ControlPlaneSecurity {
    initializeRBAC(): Promise<void>;
    initializeAuditLogging(): Promise<void>;
    secureOperatorInterface(): Promise<void>;
    executeHumanApprovalGates(): Promise<void>;
    runSecurityLayer(): Promise<void>;
}
