/**
 * EO-4.2 initial allowlist: ONE safe, read-only diagnostic operation.
 *
 * The agent requests `node.version`; the tool owns the exact executable
 * (`executableId: "node"`, resolved to an absolute path by trusted
 * composition) and the exact argv (`--version`). Nothing about it is
 * model-supplied, and it touches no workspace and no network.
 */
import type { ExecutionOperationDefinition, ExecutionToolDefinition } from "../../contracts/index.js";
export declare const NODE_VERSION_OPERATION: ExecutionOperationDefinition;
export declare const NODE_DIAGNOSTIC_TOOL: ExecutionToolDefinition;
