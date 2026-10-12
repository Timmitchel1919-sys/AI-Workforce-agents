/**
 * Centralized structured logging foundation.
 *
 * A single logger abstraction the rest of the system depends on, so log
 * output can later be routed to the Observability and Audit layers. It is
 * intentionally small: levels, structured metadata, child loggers with bound
 * context, and defence-in-depth redaction so secrets never reach a sink.
 */
export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";
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
export declare class ConsoleLogSink implements LogSink {
    write(record: LogRecord): void;
}
/** Keeps records in memory. Useful in tests and local inspection. */
export declare class InMemoryLogSink implements LogSink {
    readonly records: LogRecord[];
    write(record: LogRecord): void;
}
/**
 * Deep-copies `value`, replacing any value whose key looks sensitive with
 * `"[REDACTED]"`. Handles nested objects/arrays and circular references so a
 * malformed context can never crash a log call.
 */
export declare function redact(value: unknown, seen?: WeakSet<object>, depth?: number): unknown;
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
export declare class Logger {
    private readonly scope;
    private readonly level;
    private readonly sink;
    private readonly bindings;
    constructor(options?: LoggerOptions);
    isLevelEnabled(level: LogLevel): boolean;
    /** Derive a logger that inherits this logger's sink/level and adds bindings. */
    child(bindings: Record<string, unknown>, scope?: string): Logger;
    debug(message: string, context?: Record<string, unknown>): void;
    info(message: string, context?: Record<string, unknown>): void;
    warn(message: string, context?: Record<string, unknown>): void;
    error(message: string, context?: Record<string, unknown>): void;
    private emit;
}
/** Process-wide default logger. Prefer scoped loggers in application code. */
export declare const rootLogger: Logger;
/** Convenience factory for a named, scoped logger. */
export declare function createLogger(scope: string, options?: LoggerOptions): Logger;
