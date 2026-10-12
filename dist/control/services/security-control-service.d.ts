/**
 * TrustControlService — governance, trust and security for the Control Center.
 *
 * Reads need `view` (and project access for anything project-scoped). Commands
 * need `manage_security` — except approval decisions (`approve`) — and the
 * sensitive ones are administrator-only: lifting a suspension, resuming after
 * an emergency stop, editing model/tool trust, closing HIGH/CRITICAL alerts,
 * accepting a configuration baseline. The UI is a client of this service; the
 * rules live in the governor, the approvals engine and the emergency stop.
 */
import { type CommandOptions, type ControlCommandResult, type OperatorPrincipal } from "../../contracts/index.js";
import { type AlertStatus } from "../../contracts/security-governance.js";
import { LocalNpmAuditRunner, type DependencyAuditRunner, type ProjectFileSource, type SecuritySystem } from "../../core/index.js";
import type { AuditLog } from "../../core/index.js";
type Body = Record<string, unknown>;
export interface TrustControlDeps {
    security: SecuritySystem;
    audit: AuditLog;
    knownAgentIds: () => string[];
    projectExists: (projectId: string) => boolean;
    sourceFor?: (projectId: string) => Promise<ProjectFileSource | undefined>;
    /** A dependency audit runner for a project with a registered local workspace. */
    auditRunnerFor?: (projectId: string) => Promise<DependencyAuditRunner | undefined>;
    clock?: () => string;
}
export declare class TrustControlService {
    private readonly deps;
    private readonly clock;
    private readonly s;
    constructor(deps: TrustControlDeps);
    private reader;
    private project;
    private visibleProject;
    overview(p: OperatorPrincipal, projectId?: string): {
        banner: string | null;
        emergency: import("../../core/index.js").EmergencyRecord;
        dashboard: import("../../contracts/security-governance.js").SecurityDashboard;
        trustScore: import("../../contracts/security-governance.js").TrustScore;
        auditorFindings: import("../../core/index.js").GovernanceFinding[];
        ledger: {
            ok: boolean;
            entries: number;
            brokenAt?: number;
        };
        capabilities: {
            policyEngine: string;
            outboundNetworkDetection: boolean;
            dependencyScanning: boolean;
            canManage: boolean;
            isAdmin: boolean;
        };
        generatedAt: string;
    };
    policies(p: OperatorPrincipal): {
        layers: readonly string[];
        policies: {
            policyId: string;
            name: string;
            description: string;
            layer: "AGENT" | "WORKFLOW" | "SYSTEM_SECURITY" | "PROJECT_SECURITY" | "PROJECT_ARCHITECTURE" | "TASK" | "USER_REQUEST";
            priority: number;
            scope: {
                projectId?: string;
                workflowId?: string;
                agentId?: string;
                taskType?: string;
            };
            conditions: import("../../contracts/security-governance.js").PolicyCondition;
            effect: "ALLOW" | "REQUIRE_REVIEW" | "REQUIRE_SECURITY_REVIEW" | "REQUIRE_APPROVAL" | "DENY";
            approvalRequirement: "HUMAN" | "EXPLICIT_HUMAN" | null;
            securityRequirement: "REVIEW" | "SECURITY_REVIEW" | null;
            status: "DISABLED" | "ENABLED";
            builtin: boolean;
            critical: boolean;
            version: number;
            updatedAt: string;
            updatedBy: string;
        }[];
    };
    private policyView;
    policy(p: OperatorPrincipal, policyId: string): {
        policyId: string;
        name: string;
        description: string;
        layer: "AGENT" | "WORKFLOW" | "SYSTEM_SECURITY" | "PROJECT_SECURITY" | "PROJECT_ARCHITECTURE" | "TASK" | "USER_REQUEST";
        priority: number;
        scope: {
            projectId?: string;
            workflowId?: string;
            agentId?: string;
            taskType?: string;
        };
        conditions: import("../../contracts/security-governance.js").PolicyCondition;
        effect: "ALLOW" | "REQUIRE_REVIEW" | "REQUIRE_SECURITY_REVIEW" | "REQUIRE_APPROVAL" | "DENY";
        approvalRequirement: "HUMAN" | "EXPLICIT_HUMAN" | null;
        securityRequirement: "REVIEW" | "SECURITY_REVIEW" | null;
        status: "DISABLED" | "ENABLED";
        builtin: boolean;
        critical: boolean;
        version: number;
        updatedAt: string;
        updatedBy: string;
    };
    trust(p: OperatorPrincipal): {
        agents: import("../../contracts/security-governance.js").AgentTrustRecord[];
        models: import("../../contracts/security-governance.js").ModelTrustRecord[];
        defaultModelPolicy: import("../../contracts/security-governance.js").ModelTrustRecord;
        tools: import("../../contracts/security-governance.js").ToolTrustRecord[];
        states: readonly ["TRUSTED", "LIMITED", "REVIEW_REQUIRED", "SUSPENDED", "DISABLED"];
    };
    approvals(p: OperatorPrincipal, params: URLSearchParams): {
        approvals: import("../../contracts/security-governance.js").GovernanceApprovalView[];
    };
    approval(p: OperatorPrincipal, id: string): import("../../contracts/security-governance.js").GovernanceApprovalView;
    alerts(p: OperatorPrincipal, params: URLSearchParams): {
        alerts: {
            alertId: string;
            severity: import("../../contracts/security-governance.js").AlertSeverity;
            source: "POLICY" | "SECRET_GUARD" | "THREAT_DETECTOR" | "DRIFT" | "CONFIG_MONITOR" | "AUDITOR" | "DEPENDENCY" | "EMERGENCY" | "AGENT_TRUST" | "INTEGRATION";
            projectId?: string;
            executionId?: string;
            taskId?: string;
            agentId?: string;
            event: string;
            description: string;
            evidence: Record<string, string | number | boolean>;
            createdAt: string;
            updatedAt: string;
            status: AlertStatus;
            dedupeKey: string;
            occurrences: number;
            history: {
                status: AlertStatus;
                at: string;
                by: string;
                note?: string;
            }[];
            id: string;
        }[];
    };
    private alertView;
    alert(p: OperatorPrincipal, id: string): {
        alertId: string;
        severity: import("../../contracts/security-governance.js").AlertSeverity;
        source: "POLICY" | "SECRET_GUARD" | "THREAT_DETECTOR" | "DRIFT" | "CONFIG_MONITOR" | "AUDITOR" | "DEPENDENCY" | "EMERGENCY" | "AGENT_TRUST" | "INTEGRATION";
        projectId?: string;
        executionId?: string;
        taskId?: string;
        agentId?: string;
        event: string;
        description: string;
        evidence: Record<string, string | number | boolean>;
        createdAt: string;
        updatedAt: string;
        status: AlertStatus;
        dedupeKey: string;
        occurrences: number;
        history: {
            status: AlertStatus;
            at: string;
            by: string;
            note?: string;
        }[];
        id: string;
    };
    /** Audit explorer: who, what, when, why (policy), result. */
    ledger(p: OperatorPrincipal, params: URLSearchParams): {
        entries: {
            seq: number;
            at: string;
            who: string;
            actor: string;
            what: string;
            operation: string;
            severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "INFO" | null;
            projectId: string | null;
            agentId: string | null;
            taskId: string | null;
            executionId: string | null;
            toolId: string | null;
            action: string | null;
            resource: string | null;
            risk: string | null;
            policyIds: string[];
            result: string;
            detail: Record<string, string | number | boolean>;
            hash: string;
        }[];
        verification: {
            ok: boolean;
            entries: number;
            brokenAt?: number;
        };
    };
    private entryView;
    simulate(p: OperatorPrincipal, params: URLSearchParams): {
        decision: import("../../contracts/security-governance.js").SecurityDecision;
        executed: boolean;
    };
    secrets(p: OperatorPrincipal): {
        detectionsThisProcess: number;
        detections7d: number;
        recent: {
            seq: number;
            at: string;
            who: string;
            actor: string;
            what: string;
            operation: string;
            severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "INFO" | null;
            projectId: string | null;
            agentId: string | null;
            taskId: string | null;
            executionId: string | null;
            toolId: string | null;
            action: string | null;
            resource: string | null;
            risk: string | null;
            policyIds: string[];
            result: string;
            detail: Record<string, string | number | boolean>;
            hash: string;
        }[];
        protections: string[];
        configured: {
            name: string;
            configured: boolean;
        }[];
        note: string;
    };
    projectSecurity(p: OperatorPrincipal, projectId: string): Promise<{
        projectId: string;
        configBaseline: {
            establishedAt: string;
            files: number;
            pending: {
                path: string;
                change: "added" | "modified" | "removed";
                at: string;
                severity: import("../../contracts/security-governance.js").AlertSeverity;
            }[];
            acceptedAt: string | null;
        } | null;
        dependencyScan: import("../../core/index.js").DependencyScan | null;
        openAlerts: number;
        drift7d: number;
    }>;
    execute(command: string, principal: OperatorPrincipal, body: Body, options?: CommandOptions): Promise<ControlCommandResult>;
    private admin;
    private run;
    private policyInput;
    private result;
}
export { LocalNpmAuditRunner };
