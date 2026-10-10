/**
 * Bounded output, structured logs and immutable receipts (EO-4.1).
 *
 * Receipts are historical evidence: validated, redacted, deep-frozen and
 * append-only — a stored receipt can never be rewritten. Audit events record
 * governance history; receipts record what one attempt did. Both reference
 * the same session.
 */
import { type BoundedOutput, type ExecutionLogEntry, type ExecutionReceipt, type LogSeverity } from "../../contracts/index.js";
export declare const REDACTED_VALUE = "[redacted]";
/** Redact known secret shapes and any explicitly known secret values. */
export declare function redactSecrets(text: string, knownSecrets?: readonly string[]): {
    text: string;
    redactions: number;
};
/** Redact, then cut to `maxBytes` (UTF-8). Truncation is always explicit. */
export declare function boundOutput(text: string, maxBytes: number, knownSecrets?: readonly string[]): BoundedOutput & {
    redactions: number;
};
export declare function createLogEntry(input: {
    sessionId: string;
    attemptId?: string;
    toolId?: string;
    timestamp: string;
    severity: LogSeverity;
    message: string;
    maxBytes?: number;
    knownSecrets?: readonly string[];
}): ExecutionLogEntry;
/**
 * Build an immutable receipt. Every string field passes secret redaction;
 * the number of redacted values is recorded. `simulated` must be stated.
 */
export declare function createExecutionReceipt(input: Omit<ExecutionReceipt, "redaction">, knownSecrets?: readonly string[]): ExecutionReceipt;
/** Append-only receipt store: a receipt id can be written exactly once. */
export declare class InMemoryExecutionReceiptStore {
    private readonly receipts;
    record(receipt: ExecutionReceipt): ExecutionReceipt;
    get(receiptId: string): ExecutionReceipt | undefined;
    forSession(sessionId: string): ExecutionReceipt[];
}
