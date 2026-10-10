/**
 * Bounded output, structured logs and immutable receipts (EO-4.1).
 *
 * Receipts are historical evidence: validated, redacted, deep-frozen and
 * append-only — a stored receipt can never be rewritten. Audit events record
 * governance history; receipts record what one attempt did. Both reference
 * the same session.
 */
import {
  KNOWN_SECRET_VALUE_PATTERN,
  ValidationError,
  type BoundedOutput,
  type ExecutionLogEntry,
  type ExecutionReceipt,
  type LogSeverity,
} from "../../contracts/index.js";

export const REDACTED_VALUE = "[redacted]";

const GLOBAL_SECRET = new RegExp(KNOWN_SECRET_VALUE_PATTERN.source, "g");

/** Redact known secret shapes and any explicitly known secret values. */
export function redactSecrets(
  text: string,
  knownSecrets: readonly string[] = [],
): { text: string; redactions: number } {
  let redactions = 0;
  let out = text.replace(GLOBAL_SECRET, () => {
    redactions += 1;
    return REDACTED_VALUE;
  });
  for (const secret of knownSecrets) {
    if (secret.length < 4) continue;
    const parts = out.split(secret);
    if (parts.length > 1) {
      redactions += parts.length - 1;
      out = parts.join(REDACTED_VALUE);
    }
  }
  return { text: out, redactions };
}

/** Redact, then cut to `maxBytes` (UTF-8). Truncation is always explicit. */
export function boundOutput(
  text: string,
  maxBytes: number,
  knownSecrets: readonly string[] = [],
): BoundedOutput & { redactions: number } {
  const { text: clean, redactions } = redactSecrets(text, knownSecrets);
  const bytes = Buffer.from(clean, "utf8");
  if (bytes.length <= maxBytes) {
    return {
      text: clean,
      truncated: false,
      originalBytes: bytes.length,
      redactions,
    };
  }
  // Cut on a character boundary.
  let cut = bytes.subarray(0, maxBytes).toString("utf8");
  if (cut.endsWith("�")) cut = cut.slice(0, -1);
  return {
    text: cut,
    truncated: true,
    originalBytes: bytes.length,
    redactions,
  };
}

export function createLogEntry(input: {
  sessionId: string;
  attemptId?: string;
  toolId?: string;
  timestamp: string;
  severity: LogSeverity;
  message: string;
  maxBytes?: number;
  knownSecrets?: readonly string[];
}): ExecutionLogEntry {
  const bounded = boundOutput(
    input.message,
    input.maxBytes ?? 2048,
    input.knownSecrets,
  );
  return Object.freeze({
    sessionId: input.sessionId,
    ...(input.attemptId ? { attemptId: input.attemptId } : {}),
    ...(input.toolId ? { toolId: input.toolId } : {}),
    timestamp: input.timestamp,
    severity: input.severity,
    message: bounded.text,
    truncated: bounded.truncated,
  });
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const entry of Object.values(value as Record<string, unknown>)) {
      deepFreeze(entry);
    }
  }
  return value;
}

/**
 * Build an immutable receipt. Every string field passes secret redaction;
 * the number of redacted values is recorded. `simulated` must be stated.
 */
export function createExecutionReceipt(
  input: Omit<ExecutionReceipt, "redaction">,
  knownSecrets: readonly string[] = [],
): ExecutionReceipt {
  if (typeof input.simulated !== "boolean") {
    throw new ValidationError("receipt.simulated must be stated explicitly");
  }
  if (Date.parse(input.endedAt) < Date.parse(input.startedAt)) {
    throw new ValidationError("receipt.endedAt precedes startedAt");
  }
  let redactedValues = 0;
  const scrub = (value: unknown): unknown => {
    if (typeof value === "string") {
      const r = redactSecrets(value, knownSecrets);
      redactedValues += r.redactions;
      return r.text;
    }
    if (Array.isArray(value)) return value.map(scrub);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([k, v]) => [
          k,
          scrub(v),
        ]),
      );
    }
    return value;
  };
  const clean = scrub(structuredClone(input)) as Omit<
    ExecutionReceipt,
    "redaction"
  >;
  return deepFreeze({ ...clean, redaction: { applied: true, redactedValues } });
}

/** Append-only receipt store: a receipt id can be written exactly once. */
export class InMemoryExecutionReceiptStore {
  private readonly receipts = new Map<string, ExecutionReceipt>();

  record(receipt: ExecutionReceipt): ExecutionReceipt {
    if (this.receipts.has(receipt.receiptId)) {
      throw new ValidationError(
        `receipt ${receipt.receiptId} already exists; receipts are immutable`,
      );
    }
    this.receipts.set(receipt.receiptId, deepFreeze(structuredClone(receipt)));
    return this.receipts.get(receipt.receiptId)!;
  }

  get(receiptId: string): ExecutionReceipt | undefined {
    return this.receipts.get(receiptId);
  }

  forSession(sessionId: string): ExecutionReceipt[] {
    return [...this.receipts.values()].filter((r) => r.sessionId === sessionId);
  }
}
