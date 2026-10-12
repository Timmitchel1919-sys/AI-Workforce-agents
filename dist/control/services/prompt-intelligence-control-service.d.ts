/**
 * PromptIntelligenceControlService — the governed command/query surface for
 * the Context Engine + Prompt Intelligence layer (Phase 3).
 *
 * Every command is authorized by the domain service, audited as a
 * `control_command` (denied and rejected included, with secret-free
 * traceability metadata) and returned as a structured `ControlCommandResult`.
 * The UI never mutates state itself, and nothing here executes an agent.
 */
import { type CommandOptions, type ControlCommandResult, type OperatorPrincipal } from "../../contracts/index.js";
import type { PromptRequestSummary, PromptRequestView } from "../../contracts/prompt-intelligence.js";
import type { AuditLog, PromptIntelligenceService } from "../../core/index.js";
type Body = Record<string, unknown>;
export declare class PromptIntelligenceControlService {
    private readonly service;
    private readonly audit;
    constructor(service: PromptIntelligenceService, audit: AuditLog);
    list(principal: OperatorPrincipal, filter?: {
        projectId?: string;
        limit?: number;
    }): PromptRequestSummary[];
    get(principal: OperatorPrincipal, requestId: string): PromptRequestView;
    promptPrepare(p: OperatorPrincipal, b: Body, o?: CommandOptions): Promise<ControlCommandResult>;
    promptRequestApproval(p: OperatorPrincipal, b: Body, o?: CommandOptions): Promise<ControlCommandResult>;
    private run;
    private result;
}
export {};
