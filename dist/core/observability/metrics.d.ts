export type MetricLabels = Readonly<Record<string, string | number | boolean>>;
export interface MetricsPort {
    /** Increment a counter by `value` (default 1). */
    counter(name: string, labels?: MetricLabels, value?: number): void;
    /** Record a duration in milliseconds. */
    duration(name: string, ms: number, labels?: MetricLabels): void;
}
/**
 * Writes one JSON line per event to `writer` (default `console.log`). Cloud
 * Logging turns each line into a structured LogEntry; locally the lines are
 * grep-friendly. One instance per composition root; keep it long-lived.
 */
export declare function createJsonLineMetrics(options?: {
    writer?: (line: string) => void;
    clock?: () => string;
}): MetricsPort;
/** No-op fallback for tests and compositions that haven't wired metrics. */
export declare const noopMetrics: MetricsPort;
