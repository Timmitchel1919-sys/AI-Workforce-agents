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

/** A well-formed id: short, and only characters that are safe in logs, headers and audit records. */
const SAFE_CORRELATION_ID = /^[A-Za-z0-9_.:-]{1,128}$/;

/**
 * Use the caller's correlation id when it is well-formed (<=128 chars of `[A-Za-z0-9_.:-]`);
 * anything else — empty, oversized, or with other characters — is replaced by a minted id, so a
 * caller can neither bloat nor forge free-form text into the audit trail.
 */
export function resolveCorrelationId(options?: CommandOptions): string {
  return sanitizeCorrelationId(options?.correlationId) ?? createCorrelationId();
}

/** The trimmed id when well-formed, else undefined (the caller mints one). */
export function sanitizeCorrelationId(supplied: unknown): string | undefined {
  if (typeof supplied !== "string") return undefined;
  const trimmed = supplied.trim();
  return SAFE_CORRELATION_ID.test(trimmed) ? trimmed : undefined;
}
