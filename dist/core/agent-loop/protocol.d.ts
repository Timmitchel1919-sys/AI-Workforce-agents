/**
 * Agent action protocol (Layer 6).
 *
 * The model provider is text-in / text-out, so the loop speaks a small,
 * closed JSON protocol: the model replies with exactly ONE action object per
 * turn. Anything else is a malformed reply and is bounced back for repair —
 * it is never interpreted loosely, and nothing in a reply is ever executed
 * except through the governed tool session.
 */
export declare const AGENT_ACTIONS: readonly ["list_tree", "read_file", "create_file", "update_file", "rename_file", "delete_file", "run_command", "list_capabilities", "use_capability", "finish"];
export type AgentActionName = (typeof AGENT_ACTIONS)[number];
export declare const FINISH_STATUSES: readonly ["success", "blocked", "approved", "changes_requested"];
export type FinishStatus = (typeof FINISH_STATUSES)[number];
export type AgentAction = {
    action: "list_tree";
    path?: string;
} | {
    action: "read_file";
    path: string;
} | {
    action: "create_file";
    path: string;
    content: string;
} | {
    action: "update_file";
    path: string;
    content: string;
    expectedHash?: string;
} | {
    action: "rename_file";
    from: string;
    to: string;
} | {
    action: "delete_file";
    path: string;
} | {
    action: "run_command";
    command: string;
} | {
    action: "list_capabilities";
} | {
    action: "use_capability";
    capability: string;
    parameters: Record<string, unknown>;
    resource?: string;
} | {
    action: "finish";
    status: FinishStatus;
    summary: string;
    evidence?: string[];
};
export type ParsedAction = {
    ok: true;
    action: AgentAction;
    reason?: string;
} | {
    ok: false;
    error: string;
};
/** The first balanced top-level JSON object in `text`, string-aware. */
export declare function extractJsonObject(text: string): string | undefined;
/** Strictly validate one model reply into one action. */
export declare function parseAction(reply: string): ParsedAction;
