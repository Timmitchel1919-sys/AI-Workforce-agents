/**
 * EO-4.4 build/test tool definitions — trusted composition only.
 *
 * NO GENERAL-PURPOSE TERMINAL. A build tool is ONE trusted executable with a
 * FIXED argument vector per operation, chosen by the repository owner in
 * composition — never by an agent (there is no input that reaches argv, no
 * `npm run <string>`). Shells and interpreters-with-eval are refused, and so
 * are dependency installation, publishing and deployment arguments:
 * dependencies must already be present (DEPENDENCY_MISSING otherwise).
 *
 * The platform presets below are DATA ONLY. They are not registered in
 * production; a platform becomes runnable only when an environment instance
 * reports its toolchain and composition registers the tool explicitly.
 */
import { type ExecutionOperationDefinition, type ExecutionStageKind, type ExecutionToolDefinition, type OperationOutputSpec } from "../../contracts/index.js";
export interface BuildCommandSpec {
    operationId: string;
    stageKind: Exclude<ExecutionStageKind, "deployment">;
    description: string;
    /** Fixed argv (never model-controlled). */
    argv: readonly string[];
    /** Outputs are written (build) or only read (tests, checks). */
    workspaceAccess?: "read" | "write";
    timeoutMs?: number;
    /** Workspace-relative paths that must exist (e.g. installed deps). */
    requiredPaths?: readonly string[];
    output?: OperationOutputSpec;
}
export interface BuildToolSpec {
    toolId: string;
    displayName?: string;
    executableId: string;
    requiredToolchains: readonly string[];
    commands: readonly BuildCommandSpec[];
    environmentVariables?: readonly string[];
}
/**
 * Validate a trusted build tool spec and produce its tool + operations.
 * Throws ValidationError for shells, eval flags, install/publish/deploy
 * arguments, unsafe paths or empty argv.
 */
export declare function defineBuildTool(spec: BuildToolSpec): {
    tool: ExecutionToolDefinition;
    operations: ExecutionOperationDefinition[];
};
/**
 * Platform presets (data only, NOT registered). Each assumes dependencies
 * were restored by a trusted, reviewed process beforehand — the presets
 * never restore, install, sign, upload or deploy.
 */
export declare const BUILD_PROFILE_PRESETS: Readonly<Record<string, BuildToolSpec>>;
