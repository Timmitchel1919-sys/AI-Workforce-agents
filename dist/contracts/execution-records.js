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
/**
 * A create-only record already exists. Extends Error (not a contracts error
 * class) so this module has no load-time dependency on contracts/index.
 */
export class RecordExistsError extends Error {
    constructor(id) {
        super(`record ${id} already exists`);
        this.name = "RecordExistsError";
    }
}
export const MAX_RECORD_PAGE = 500;
