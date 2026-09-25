/**
 * EO-4.8 — durable execution state.
 *
 * Execution evidence (receipts, verification results, reviews, stage sets,
 * commit/push receipts, pull requests, deployment candidates, releases,
 * idempotency reservations) is written through this port by the Control
 * Plane only — never by the browser. Writes are AWAITED before a command
 * returns, so a response never claims state that is not durable.
 *
 * Records are opaque JSON payloads with a few top-level index fields used
 * for single-field equality lookups (Firestore automatic indexes).
 */

export interface RecordIndex {
  projectId: string;
  /** Record family, e.g. `receipt`, `verification`, `commit`, `release`. */
  kind: string;
  createdAt: string;
  sessionId?: string;
}

/**
 * A create-only record already exists. Extends Error (not a contracts error
 * class) so this module has no load-time dependency on contracts/index.
 */
export class RecordExistsError extends Error {
  constructor(id: string) {
    super(`record ${id} already exists`);
    this.name = "RecordExistsError";
  }
}

export interface ExecutionRecordStore {
  /** Create-only (immutable evidence). Throws RecordExistsError on a duplicate. */
  create(id: string, index: RecordIndex, record: unknown): Promise<void>;
  /** Insert or replace (records whose status legitimately advances). */
  put(id: string, index: RecordIndex, record: unknown): Promise<void>;
  get<T>(id: string): Promise<T | undefined>;
  /**
   * Records whose index field equals `value`, newest first, at most `limit`
   * (hard-capped at 500). `kind` narrows the family.
   */
  listBy<T>(
    field: "projectId" | "sessionId",
    value: string,
    options: { kind?: string; limit: number },
  ): Promise<T[]>;
}

export const MAX_RECORD_PAGE = 500;
