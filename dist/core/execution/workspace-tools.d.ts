/**
 * EO-4.3 registered workspace + repository operations.
 *
 * WORKSPACE ≠ HOST FILESYSTEM · FILE WRITE ≠ FILE DELETE ·
 * REPOSITORY WRITE ≠ GIT COMMIT · GIT COMMIT ≠ GIT PUSH.
 *
 * Agents address these by `{ toolId, operationId, input }` only. There is no
 * raw git, no git flags, no host path, no stage/commit/push/branch operation.
 * Repository operations run a trusted `git` with FIXED, hardened, read-only
 * argument templates (hooks/fsmonitor/external diff/textconv/pager/credential
 * helpers disabled, every network protocol denied).
 */
import type { ExecutionOperationDefinition, ExecutionToolDefinition } from "../../contracts/index.js";
export declare const WORKSPACE_OPERATIONS: readonly ExecutionOperationDefinition[];
export declare const WORKSPACE_TOOL: ExecutionToolDefinition;
export declare const REPOSITORY_OPERATIONS: readonly ExecutionOperationDefinition[];
export declare const REPOSITORY_TOOL: ExecutionToolDefinition;
