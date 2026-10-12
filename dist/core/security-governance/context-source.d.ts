/**
 * Governance context for the Prompt Engineer (Layer 3 `ContextSource`).
 *
 * The generated execution prompt states what is permitted, what is forbidden,
 * what needs approval and which environment applies. This is a briefing, not
 * the control: the same rules are enforced by the governor at runtime whatever
 * the prompt says.
 */
import type { ContextFragment, ContextRequest, ContextSource } from "../../contracts/prompt-intelligence.js";
import type { PolicyStore } from "./governor.js";
export declare class GovernanceContextSource implements ContextSource {
    private readonly policies;
    readonly id = "governance";
    readonly categories: "security"[];
    constructor(policies: PolicyStore);
    fetch(request: ContextRequest): readonly ContextFragment[];
}
