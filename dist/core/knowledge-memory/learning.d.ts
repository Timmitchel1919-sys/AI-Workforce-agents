/**
 * Controlled learning loop:
 *
 *   EXECUTION → RESULT → ANALYSIS → KNOWLEDGE EXTRACTION → VALIDATION → MEMORY
 *     → FUTURE CONTEXT → BETTER EXECUTION
 *
 * Extraction is deterministic and evidence-based (recorded commands, validation
 * stages, changed files). Only verified facts become ACTIVE execution memory;
 * rules ("recurring failure pattern") become DRAFT candidates that wait for the
 * user. There is no autonomous self-modification and no model call here.
 */
import type { OrchTask } from "../../contracts/execution-orchestration.js";
import { type RuntimeSession } from "../../contracts/execution-runtime.js";
import type { RuntimeOutcome, TaskExecutionContext } from "../execution-orchestration/ports.js";
import type { MemoryService } from "./memory-service.js";
import type { RetrievalEngine } from "./retrieval.js";
export declare function failureSignature(stage: string, line: string): string;
export interface LearningReport {
    usageUpdated: number;
    created: string[];
    candidates: string[];
    skipped: string[];
}
export declare class ExecutionLearner {
    private readonly memory;
    private readonly retrieval;
    constructor(memory: MemoryService, retrieval: RetrievalEngine);
    learn(input: {
        session: RuntimeSession;
        task: OrchTask;
        context: TaskExecutionContext;
        outcome: RuntimeOutcome;
    }): LearningReport;
}
