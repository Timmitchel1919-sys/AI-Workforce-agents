import type { ModelProvider } from "../../contracts/index.js";
import type { AgentTrustRecord, GovPolicy, LedgerEntry, ModelTrustRecord, SecurityAlert, ToolTrustRecord, TrustScore, SecurityDashboard } from "../../contracts/security-governance.js";
import type { ApprovalSystem } from "../approvals/approval-system.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { TaskGovernancePort } from "../execution-orchestration/ports.js";
import type { ActionGate } from "../execution-runtime/tools.js";
import { SecurityAlertService, ThreatDetector } from "./alerts.js";
import { GovernanceApprovals, type ApprovalMeta } from "./approvals.js";
import { GovernanceContextSource } from "./context-source.js";
import { EmergencyStop, type EmergencyRecord } from "./emergency.js";
import { PolicyStore, SecurityGovernor, type AgentDirectory } from "./governor.js";
import { GovernanceLedger } from "./ledger.js";
import { GovernedModelProvider, ModelGateway } from "./model-gateway.js";
import { ConfigMonitor, DependencyScanner, GovernanceAuditor, SecretGuard, type ConfigBaseline, type DependencyScan } from "./monitoring.js";
import { TrustRegistry } from "./trust-registry.js";
import type { Repository } from "../../contracts/persistence.js";
export * from "./resources.js";
export * from "./risk-engine.js";
export * from "./policy-engine.js";
export * from "./permissions.js";
export * from "./trust-registry.js";
export * from "./ledger.js";
export * from "./alerts.js";
export * from "./approvals.js";
export * from "./emergency.js";
export * from "./governor.js";
export * from "./monitoring.js";
export * from "./model-gateway.js";
export * from "./context-source.js";
export interface SecurityRepos {
    policies: Repository<GovPolicy>;
    agentTrust: Repository<AgentTrustRecord>;
    modelTrust: Repository<ModelTrustRecord>;
    toolTrust: Repository<ToolTrustRecord>;
    alerts: Repository<SecurityAlert>;
    ledger: Repository<LedgerEntry>;
    approvalMeta: Repository<ApprovalMeta>;
    emergency: Repository<EmergencyRecord>;
    configBaselines: Repository<ConfigBaseline>;
    dependencyScans: Repository<DependencyScan>;
}
export declare function inMemorySecurityRepos(): SecurityRepos;
export interface SecuritySystemOptions {
    repos: SecurityRepos;
    audit: AuditLog;
    approvals: ApprovalSystem;
    agents: AgentDirectory & {
        list?: () => {
            id: string;
        }[];
    };
    isAgentEnabled?: (agentId: string) => boolean;
    clock?: () => string;
    /** Cancel an agent's live executions when it is suspended. */
    onSuspend?: (agentId: string, reason: string) => void;
    annotateSession?: (executionId: string, patch: {
        reviewRequired?: string[];
        drift?: import("../../contracts/security-governance.js").DriftReport;
    }) => void;
}
export declare class SecuritySystem {
    readonly ledger: GovernanceLedger;
    readonly trust: TrustRegistry;
    readonly policies: PolicyStore;
    readonly approvals: GovernanceApprovals;
    readonly alerts: SecurityAlertService;
    readonly detector: ThreatDetector;
    readonly emergency: EmergencyStop;
    readonly governor: SecurityGovernor;
    readonly secrets: SecretGuard;
    readonly config: ConfigMonitor;
    readonly deps: DependencyScanner;
    readonly auditor: GovernanceAuditor;
    readonly modelGateway: ModelGateway;
    readonly contextSource: GovernanceContextSource;
    private readonly clock;
    private readonly knownAgents;
    constructor(o: SecuritySystemOptions);
    /** The policy decision point the Layer 5 runtime asks before every write, delete, command and commit. */
    gate(): ActionGate;
    /** Wrap a model provider with the gateway (secret/data/emergency checks, output redaction). */
    governedModel(inner: ModelProvider): GovernedModelProvider;
    /** The Layer 4 orchestrator's governance port. */
    taskGovernance(): TaskGovernancePort;
    dashboard(projectId?: string): SecurityDashboard;
    trustScore(projectId?: string): TrustScore;
}
