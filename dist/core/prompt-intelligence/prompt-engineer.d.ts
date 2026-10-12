/**
 * Prompt Engineer (Phase 3).
 *
 * Turns an analysed intent + resolved context into a structured, agent-ready
 * execution prompt. Deterministic and template-driven: the same inputs always
 * produce the same prompt, every line is traceable to the intent or to a
 * context fragment, and nothing is invented.
 *
 * Verbosity is controlled by omission: a section with nothing to say is not
 * rendered, project facts already known are stated once, and context is the
 * relevance-filtered set from the Context Engine — never the whole project.
 */
import type { GeneratedPrompt, IntentAnalysis, ResolvedContext } from "../../contracts/prompt-intelligence.js";
export interface PromptEngineerInput {
    requestId: string;
    version: number;
    projectId: string;
    taskId?: string;
    intent: IntentAnalysis;
    context: ResolvedContext;
    createdAt: string;
}
export declare class PromptEngineer {
    generate(input: PromptEngineerInput): GeneratedPrompt;
}
