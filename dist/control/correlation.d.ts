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
export declare function createCorrelationId(): string;
/**
 * Use the caller's correlation id when it is well-formed (<=128 chars of `[A-Za-z0-9_.:-]`);
 * anything else — empty, oversized, or with other characters — is replaced by a minted id, so a
 * caller can neither bloat nor forge free-form text into the audit trail.
 */
export declare function resolveCorrelationId(options?: CommandOptions): string;
/** The trimmed id when well-formed, else undefined (the caller mints one). */
export declare function sanitizeCorrelationId(supplied: unknown): string | undefined;
