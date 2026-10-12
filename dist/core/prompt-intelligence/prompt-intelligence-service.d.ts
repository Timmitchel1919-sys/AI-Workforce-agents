import { type OperatorPrincipal, type Repository } from "../../contracts/index.js";
import { type PreparedExecutionRequest, type PromptRequestRecord, type PromptRequestSummary, type PromptRequestView } from "../../contracts/prompt-intelligence.js";
import type { ApprovalSystem } from "../approvals/approval-system.js";
import type { AgentRegistry } from "../registry/agent-registry.js";
import type { ProjectRegistry } from "../registry/project-registry.js";
import type { ContextEngine } from "./context-engine.js";
import type { IntentAnalyzer } from "./intent-analyzer.js";
import { PromptEngineer } from "./prompt-engineer.js";
import { PromptValidator } from "./prompt-validator.js";
export interface PromptIntelligenceDeps {
    projects: Pick<ProjectRegistry, "list" | "has">;
    analyzer: IntentAnalyzer;
    engine: ContextEngine;
    records: Repository<PromptRequestRecord>;
    approvals: Pick<ApprovalSystem, "request" | "get">;
    agents: Pick<AgentRegistry, "list">;
    engineer?: PromptEngineer;
    validator?: PromptValidator;
    clock?: () => string;
    newId?: () => string;
}
export interface PrepareInput {
    request?: unknown;
    projectId?: unknown;
    taskId?: unknown;
    correlationId?: string;
}
export declare class PromptIntelligenceService {
    private readonly deps;
    private readonly engineer;
    private readonly validator;
    private readonly clock;
    private readonly newId;
    constructor(deps: PromptIntelligenceDeps);
    private requirePreparer;
    private requireReader;
    /** A record is visible to project members; an unresolved one only to its author. */
    private canSee;
    private candidates;
    prepare(principal: OperatorPrincipal, input: PrepareInput): Promise<PromptRequestView>;
    requestApproval(principal: OperatorPrincipal, input: {
        requestId?: unknown;
    }): Promise<PromptRequestView>;
    list(principal: OperatorPrincipal, filter?: {
        projectId?: string;
        limit?: number;
    }): PromptRequestSummary[];
    get(principal: OperatorPrincipal, requestId: string): PromptRequestView;
    /** The typed hand-off Phase 4 consumes. */
    executionRequest(record: PromptRequestRecord): PreparedExecutionRequest;
    private view;
    private summary;
    /** The approval state is derived from the live approval, never trusted from the record. */
    private approvalState;
    private mustSee;
    private registeredCapabilities;
    private requireRequest;
    private optionalId;
}
