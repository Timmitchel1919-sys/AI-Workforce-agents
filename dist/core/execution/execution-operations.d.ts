/**
 * Registered execution operations + structured input validation (EO-4.1).
 *
 * The agent-facing boundary is `{ operationId, input }`. Unknown operation →
 * deny. Input is validated field by field against the operation's declared
 * schema; unexpected properties are rejected; workspace paths are resolved
 * relative to the workspace. Model output is untrusted input: nothing here is
 * ever interpreted as a command, module name or function name.
 */
import { type ExecutableDefinition, type ExecutionOperationDefinition, type ExecutionStageKind, type StructuredInvocation } from "../../contracts/index.js";
export declare class ExecutionOperationRegistry {
    private readonly operations;
    register(operation: ExecutionOperationDefinition): ExecutionOperationDefinition;
    /** Exact lookup. There is no dynamic resolution of unknown ids. */
    get(operationId: string): ExecutionOperationDefinition | undefined;
    forStageKind(kind: ExecutionStageKind): ExecutionOperationDefinition[];
    list(): ExecutionOperationDefinition[];
}
export type ValidatedInput = Readonly<Record<string, string | number>>;
/**
 * Validate structured input for an operation. Throws
 * `ExecutionDeniedError("INVALID_TOOL_INPUT")` for schema violations and
 * `ExecutionDeniedError("WORKSPACE_VIOLATION")` for paths escaping the workspace.
 */
export declare function validateOperationInput(operation: ExecutionOperationDefinition, input: Record<string, unknown> | undefined): ValidatedInput;
/**
 * Render a server-controlled executable template into a structured
 * invocation. Arguments come ONLY from the template: literals, or validated
 * enum / bounded integer / workspace-path inputs. There is no free-form
 * argument and no shell. Not executed anywhere in EO-4.1.
 */
export declare function buildStructuredInvocation(executable: ExecutableDefinition, operationId: string, input: ValidatedInput, workingDirectoryRef: string, timeoutMs: number): StructuredInvocation;
