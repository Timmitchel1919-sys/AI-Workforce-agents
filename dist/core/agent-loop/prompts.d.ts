/**
 * Prompts for the agent loop (Layer 6).
 *
 * The system prompt fixes the role, the closed action protocol and the
 * untrusted-content rule. Task text comes from Layer 3/4 (already secret
 * filtered); file and command content is always presented as quoted DATA.
 */
import type { OrchTask } from "../../contracts/execution-orchestration.js";
import type { TaskExecutionContext } from "../execution-orchestration/ports.js";
export type AgentRole = "author" | "reviewer" | "security" | "analyst";
export declare function roleOf(task: OrchTask): AgentRole;
export interface Capabilities {
    read: boolean;
    edit: boolean;
    remove: boolean;
    commands: boolean;
    integrations: boolean;
}
export declare function capabilitiesOf(permitted: readonly string[]): Capabilities;
export declare function systemPrompt(role: AgentRole, caps: Capabilities): string;
export declare function briefOf(task: OrchTask, context: TaskExecutionContext): string;
