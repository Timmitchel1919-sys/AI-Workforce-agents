/** Small deterministic helpers shared across core modules. */
import { randomBytes } from "node:crypto";
let sequence = 0;
/**
 * Random per-process tag. The counter alone restarts at 1 on every cold start,
 * so ids from different instances collided on persisted records (silent
 * overwrites and "immutable" startup failures in production).
 */
const PROCESS_TAG = randomBytes(6).toString("hex");
/** Identifier unique across processes; monotonic within one process. */
export function createId(prefix) {
    sequence += 1;
    return `${prefix}_${sequence.toString(36)}_${PROCESS_TAG}`;
}
/** Current time as an ISO-8601 string. Wrapped so it can be stubbed later. */
export function now() {
    return new Date().toISOString();
}
