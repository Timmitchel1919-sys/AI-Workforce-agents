/**
 * Correlation ids.
 *
 * A single control operation should be traceable end to end:
 *
 *   CONTROL REQUEST → COMMAND → TASK / WORKFLOW → CORE OPERATION → AUDIT EVENT
 *
 * The id is generated with the same deterministic `createId` infrastructure the
 * rest of core uses, so it is stable within a run and never a source of
 * nondeterminism in tests. A caller (a future HTTP layer) may supply its own id
 * — a non-empty string is used verbatim; anything else is replaced.
 */
import { type CommandOptions } from "../contracts/index.js";
import { createId } from "../core/index.js";

export function createCorrelationId(): string {
  return createId("corr");
}

/** Use the caller's correlation id when it is a non-empty string; else mint one. */
export function resolveCorrelationId(options?: CommandOptions): string {
  const supplied = options?.correlationId;
  if (typeof supplied === "string" && supplied.trim().length > 0) {
    return supplied.trim();
  }
  return createCorrelationId();
}
