import type { GeneratedPrompt, IntentAnalysis, PromptValidation, ResolvedContext } from "../../contracts/prompt-intelligence.js";
export interface PromptValidatorInput {
    intent: IntentAnalysis;
    context: ResolvedContext;
    prompt: GeneratedPrompt;
    /** Does the project exist and is it visible to the requester? */
    projectExists: boolean;
    /** Canonical capability ids offered by registered agents (informational). */
    registeredCapabilities: readonly string[];
}
export declare function approvalRequiredFor(intent: IntentAnalysis): string[];
export declare class PromptValidator {
    validate(input: PromptValidatorInput): PromptValidation;
}
