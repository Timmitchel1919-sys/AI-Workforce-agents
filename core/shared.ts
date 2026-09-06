/** Small deterministic helpers shared across core modules. */

let sequence = 0;

/** Monotonic, process-local identifier. Deterministic within a single run. */
export function createId(prefix: string): string {
  sequence += 1;
  return `${prefix}_${sequence.toString(36)}`;
}

/** Current time as an ISO-8601 string. Wrapped so it can be stubbed later. */
export function now(): string {
  return new Date().toISOString();
}
