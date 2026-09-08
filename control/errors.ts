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
import {
  NotFoundError,
  PermissionDeniedError,
  StateTransitionError,
  ValidationError,
  WorkforceError,
  type ControlErrorKind,
} from "../contracts/index.js";

/** Authenticated, but the role/project scope forbids the action. */
export class ForbiddenError extends PermissionDeniedError {}

/** The command cannot run against the resource's current state. */
export class InvalidControlStateError extends StateTransitionError {}

/** An approval decision could not be enacted through the core services. */
export class ApprovalActionError extends WorkforceError {}

/** A core operation invoked by a command failed unexpectedly. */
export class CommandFailedError extends WorkforceError {}

/** Map any error to a stable kind. Unknown errors are `command_failure`. */
export function classifyErrorKind(error: unknown): ControlErrorKind {
  if (error instanceof ForbiddenError) return "forbidden";
  if (error instanceof PermissionDeniedError) return "forbidden";
  if (error instanceof NotFoundError) return "not_found";
  if (error instanceof InvalidControlStateError) return "invalid_state";
  if (error instanceof StateTransitionError) return "invalid_state";
  if (error instanceof ValidationError) return "invalid_request";
  if (error instanceof ApprovalActionError) return "approval_failure";
  if (error instanceof CommandFailedError) return "command_failure";
  return "command_failure";
}

/** Message only — never a stack trace — for a DTO `reason` field. */
export function toResultReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
