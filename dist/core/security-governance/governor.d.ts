import type { OrchTask, ExecutionRun } from "../../contracts/execution-orchestration.js";
import { type ActionRequest, type DriftReport, type GovPolicy, type SecurityDecision, type PolicyEffect, type TrustState } from "../../contracts/security-governance.js";
import type { Repository } from "../../contracts/persistence.js";
import type { ActionGate } from "../execution-runtime/tools.js";
import type { RuntimeSession } from "../../contracts/execution-runtime.js";
import type { SecurityAlertService, ThreatDetector } from "./alerts.js";
import type { GovernanceApprovals } from "./approvals.js";
import type { EmergencyStop } from "./emergency.js";
import type { GovernanceLedger } from "./ledger.js";
import type { TrustRegistry } from "./trust-registry.js";
export declare class GovernanceError extends Error {
    readonly code: "forbidden" | "not_found" | "invalid_request" | "invalid_state";
    constructor(code: "forbidden" | "not_found" | "invalid_request" | "invalid_state", message: string);
}
export declare class PolicyStore {
    private readonly clock;
    private readonly repo;
    constructor(repo: Repository<GovPolicy>, clock: () => string);
    all(): GovPolicy[];
    get(policyId: string): GovPolicy | undefined;
    create(input: Partial<GovPolicy>, by: string, admin: boolean): GovPolicy;
    private mustEditable;
    update(policyId: string, patch: Partial<GovPolicy>, by: string, admin: boolean): GovPolicy;
    setStatus(policyId: string, status: "ENABLED" | "DISABLED", by: string, admin: boolean): GovPolicy;
}
export interface AgentDirectory {
    get(agentId: string): {
        id: string;
        allowedProjects: readonly string[];
    } | undefined;
}
export interface GovernorDeps {
    policies: PolicyStore;
    trust: TrustRegistry;
    approvals: GovernanceApprovals;
    alerts: SecurityAlertService;
    detector: ThreatDetector;
    ledger: GovernanceLedger;
    emergency: EmergencyStop;
    agents: AgentDirectory;
    clock: () => string;
    /** Called after an agent is suspended (cancel its live executions). */
    onSuspend?: (agentId: string, reason: string) => void;
    /** Session annotation for review routing / drift. */
    annotateSession?: (executionId: string, patch: {
        reviewRequired?: string[];
        drift?: DriftReport;
    }) => void;
}
export interface CheckOptions {
    /** `real` writes the normal governance trail; `simulated` marks it as a simulation. */
    record?: "real" | "simulated";
    /** Create a human approval request when one is needed. */
    approvals?: boolean;
    /** Raise alerts / feed the threat detector. */
    alerts?: boolean;
}
export declare class SecurityGovernor {
    private readonly d;
    stats: {
        evaluated: number;
        lowAllowed: number;
        denied: number;
        approvalsRequested: number;
    };
    constructor(d: GovernorDeps);
    check(req: ActionRequest, opts?: CheckOptions): SecurityDecision;
    simulate(req: ActionRequest): SecurityDecision;
    private failClosed;
    private decide;
    /** A decision shell used to describe a pending approval. */
    private draft;
    private feed;
    private afterDecision;
    suspendAgent(agentId: string, by: string, reason: string): void;
    setAgentTrust(agentId: string, state: TrustState, by: string, admin: boolean, reason?: string): void;
    assessTask(input: {
        run: ExecutionRun;
        task: OrchTask;
        agentId: string;
        modelId?: string;
    }): {
        effect: PolicyEffect;
        decision: SecurityDecision;
        summary: NonNullable<OrchTask["governance"]>;
    };
    halted(): boolean;
    postCheck(input: {
        session: Pick<RuntimeSession, "executionId" | "changes" | "projectId" | "agentId" | "taskId">;
        expected: readonly string[];
        keywords?: readonly string[];
    }): DriftReport;
    gate(): ActionGate;
    layers(): readonly string[];
}
