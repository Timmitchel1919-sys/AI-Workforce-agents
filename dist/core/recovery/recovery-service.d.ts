import type { Repository } from "../../contracts/persistence.js";
import type { BackupResourceType, RecoveryDrillRecord, RecoveryRequest, RecoveryRiskLevel, RecoverySafetyAssessment } from "../../contracts/recovery.js";
import type { ZTNSecurityEvent } from "../../contracts/security.js";
import type { BackupCatalogService } from "./backup-catalog.js";
import type { BackupProvider } from "./backup-provider.js";
export interface RecoveryServiceOptions {
    catalog: BackupCatalogService;
    providers: Map<string, BackupProvider>;
    securityEvents?: Repository<ZTNSecurityEvent>;
    auditLog?: {
        log(event: string, meta?: Record<string, unknown>): void;
    };
}
export interface RequestRecoveryInput {
    projectId?: string;
    environment: string;
    requestedBy: string;
    actorType?: "human" | "agent";
    reason: string;
    incidentId?: string;
    targetResourceType: BackupResourceType;
    backupId: string;
    desiredRecoveryPoint?: string;
    currentStateSummary?: string;
    expectedImpact?: string;
    risk?: RecoveryRiskLevel;
    isolatedTarget?: string;
}
export interface OperatorIdentity {
    id: string;
    role: string;
    isHuman: boolean;
    mfaVerified?: boolean;
}
export declare class RecoveryService {
    private readonly catalog;
    private readonly providers;
    private readonly securityEvents?;
    private readonly auditLog?;
    private readonly recoveryRequests;
    private readonly drillRecords;
    constructor(options: RecoveryServiceOptions);
    /**
     * Creates a formal Recovery Request (Step 14 & 23).
     */
    requestRecovery(input: RequestRecoveryInput): Promise<RecoveryRequest>;
    /**
     * Pre-Restore Safety Analysis (Step 16 & 17).
     */
    assessRecoverySafety(requestId: string, incidentCompromiseTime?: string): Promise<RecoverySafetyAssessment>;
    /**
     * Human Approval Gate for Recovery (Step 15).
     * Invariant: Autonomous AI agents cannot approve their own or production restores.
     */
    approveRecovery(requestId: string, approver: OperatorIdentity): Promise<RecoveryRequest>;
    /**
     * Executes the approved recovery operation (Steps 11, 20, 21).
     */
    executeRecovery(requestId: string, options?: {
        isolatedTarget?: string;
        customHealthCheck?: () => Promise<boolean>;
    }): Promise<RecoveryRequest>;
    /**
     * Disaster Recovery Drill (Step 22).
     * Runs safe restore verification in an isolated drill environment.
     */
    executeRecoveryDrill(params: {
        backupId: string;
        conductedBy: string;
        isolatedTarget?: string;
    }): Promise<RecoveryDrillRecord>;
    /**
     * Protected Backup Deletion (Steps 18 & 19).
     * Protects against ransomware attacks and unauthorized wiper activity.
     */
    deleteBackup(backupId: string, actor: OperatorIdentity, justification: string): Promise<{
        allowed: boolean;
        reason: string;
    }>;
    getRecoveryRequest(id: string): RecoveryRequest | undefined;
    getDrillRecord(id: string): RecoveryDrillRecord | undefined;
    private emitSecurityEvent;
}
