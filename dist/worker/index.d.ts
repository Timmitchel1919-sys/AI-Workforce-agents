import { EphemeralLocalWorkspaceManager } from "../adapters/workspace/index.js";
import { ToolActionDispatcher } from "../core/execution/index.js";
/** Shared factory so unit tests can build the same dispatcher. */
export declare function buildDefaultDispatcher(workspace: EphemeralLocalWorkspaceManager): ToolActionDispatcher;
export declare function bootWorker(): Promise<void>;
