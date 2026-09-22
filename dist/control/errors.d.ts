/**
 * Control Plane error taxonomy.
 *
 * Built on the existing `WorkforceError` hierarchy — nothing here is a new root.
 * The command services do not throw these for expected rejections (they return a
 * `ControlCommandResult` with an `errorKind`); they exist so a future HTTP layer
 * and the query services share one vocabulary, and so `classifyErrorKind` can map
 * any thrown error to a stable `ControlErrorKind`.
 *
 * DTOs never carry a stack trace — `toResultReason` returns only the message.
 */
import { PermissionDeniedError, StateTransitionError, WorkforceError, type ControlErrorKind } from "../contracts/index.js";
/** Authenticated, but the role/project scope forbids the action. */
export declare class ForbiddenError extends PermissionDeniedError {
}
/** The command cannot run against the resource's current state. */
export declare class InvalidControlStateError extends StateTransitionError {
}
/** An approval decision could not be enacted through the core services. */
export declare class ApprovalActionError extends WorkforceError {
}
/** A core operation invoked by a command failed unexpectedly. */
export declare class CommandFailedError extends WorkforceError {
}
/** Map any error to a stable kind. Unknown errors are `command_failure`. */
export declare function classifyErrorKind(error: unknown): ControlErrorKind;
/** Message only — never a stack trace — for a DTO `reason` field. */
export declare function toResultReason(error: unknown): string;
