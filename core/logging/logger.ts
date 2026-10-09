/**
 * Centralized structured logging foundation.
 *
 * A single logger abstraction the rest of the system depends on, so log
 * output can later be routed to the Observability and Audit layers. It is
 * intentionally small: levels, structured metadata, child loggers with bound
 * context, and defence-in-depth redaction so secrets never reach a sink.
 */

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

/** Ordered from most verbose to least, for threshold comparison. */
const LEVEL_ORDER: Record<LogLevel, number> = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40,
};

export interface LogRecord {
  /** ISO-8601 timestamp. */
  timestamp: string;
  level: LogLevel;
  /** Optional logical component name (e.g. "ProjectService"). */
  scope?: string;
  message: string;
  /** Structured metadata, already redacted. */
  context: Record<string, unknown>;
}

export interface LogSink {
  write(record: LogRecord): void;
}

/** Default sink. Writes a single structured line per record. */
export class ConsoleLogSink implements LogSink {
  write(record: LogRecord): void {
    const line = JSON.stringify({
      time: record.timestamp,
      level: record.level,
      scope: record.scope,
      message: record.message,
      ...record.context,
    });
    const target =
      record.level === "ERROR"
        ? console.error
        : record.level === "WARN"
          ? console.warn
          : console.log;
    target(line);
  }
}

/** Keeps records in memory. Useful in tests and local inspection. */
export class InMemoryLogSink implements LogSink {
  readonly records: LogRecord[] = [];

  write(record: LogRecord): void {
    this.records.push(record);
  }
}

const SENSITIVE_KEY =
  /(password|passwd|secret|token|api[-_]?key|authorization|credential|private[-_]?key|refresh[-_]?token|access[-_]?token)/i;

const REDACTED = "[REDACTED]";

/**
 * Deep-copies `value`, replacing any value whose key looks sensitive with
 * `"[REDACTED]"`. Handles nested objects/arrays and circular references so a
 * malformed context can never crash a log call.
 */
export function redact(
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
  depth = 0,
): unknown {
  if (value === null || typeof value !== "object") return value;
  if (depth > 6) return "[Truncated]";
  if (seen.has(value as object)) return "[Circular]";
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((entry) => redact(entry, seen, depth + 1));
  }

  // Errors are common in log context; keep a safe, useful projection.
  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }

  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    result[key] = SENSITIVE_KEY.test(key)
      ? REDACTED
      : redact(entry, seen, depth + 1);
  }
  return result;
}

export interface LoggerOptions {
  scope?: string;
  level?: LogLevel;
  sink?: LogSink;
  /** Metadata merged into every record this logger emits. */
  bindings?: Record<string, unknown>;
}

/**
 * Structured logger. Create one per component and derive `child` loggers to
 * bind request/task context without re-passing it on every call.
 */
export class Logger {
  private readonly scope: string | undefined;
  private readonly level: LogLevel;
  private readonly sink: LogSink;
  private readonly bindings: Record<string, unknown>;

  constructor(options: LoggerOptions = {}) {
    this.scope = options.scope;
    this.level = options.level ?? "INFO";
    this.sink = options.sink ?? new ConsoleLogSink();
    this.bindings = options.bindings ?? {};
  }

  isLevelEnabled(level: LogLevel): boolean {
    return LEVEL_ORDER[level] >= LEVEL_ORDER[this.level];
  }

  /** Derive a logger that inherits this logger's sink/level and adds bindings. */
  child(bindings: Record<string, unknown>, scope?: string): Logger {
    return new Logger({
      scope: scope ?? this.scope,
      level: this.level,
      sink: this.sink,
      bindings: { ...this.bindings, ...bindings },
    });
  }

  debug(message: string, context: Record<string, unknown> = {}): void {
    this.emit("DEBUG", message, context);
  }

  info(message: string, context: Record<string, unknown> = {}): void {
    this.emit("INFO", message, context);
  }

  warn(message: string, context: Record<string, unknown> = {}): void {
    this.emit("WARN", message, context);
  }

  error(message: string, context: Record<string, unknown> = {}): void {
    this.emit("ERROR", message, context);
  }

  private emit(
    level: LogLevel,
    message: string,
    context: Record<string, unknown>,
  ): void {
    if (!this.isLevelEnabled(level)) return;
    const merged = redact({ ...this.bindings, ...context }) as Record<
      string,
      unknown
    >;
    this.sink.write({
      timestamp: new Date().toISOString(),
      level,
      scope: this.scope,
      message,
      context: merged,
    });
  }
}

/** Process-wide default logger. Prefer scoped loggers in application code. */
export const rootLogger = new Logger({ scope: "ai-workforce" });

/** Convenience factory for a named, scoped logger. */
export function createLogger(
  scope: string,
  options: LoggerOptions = {},
): Logger {
  return new Logger({ ...options, scope });
}
