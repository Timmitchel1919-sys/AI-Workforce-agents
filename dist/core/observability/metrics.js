/**
 * R11 (ADR-0034) — lightweight metrics port.
 *
 * The platform does NOT ship a Prometheus/StatsD client; the production
 * target is Cloud Logging + Logs Explorer. This port lets security-sensitive
 * code emit structured counters/timings as JSON lines that Cloud Logging
 * auto-ingests, without taking a transport dependency.
 *
 * Shape of each emitted event (one JSON object per line):
 *
 *   {
 *     "metric": "<kebab.case.name>",
 *     "kind":   "counter" | "duration_ms",
 *     "value":  <number>,
 *     "labels": { ... },         // optional, small, no secrets
 *     "at":     "<ISO timestamp>"
 *   }
 *
 * Invariants:
 *   - Values are numbers; labels are small string→string maps.
 *   - Known secret shapes in label values are redacted before emission.
 *   - Emission is non-blocking (synchronous JSON.stringify + stdout write)
 *     and never throws into the caller.
 */
import { KNOWN_SECRET_VALUE_PATTERN } from "../../contracts/index.js";
const SECRET_SHAPE = new RegExp(KNOWN_SECRET_VALUE_PATTERN.source, "g");
function sanitizeLabels(labels) {
    if (!labels)
        return {};
    const safe = {};
    for (const [k, v] of Object.entries(labels)) {
        if (typeof v === "string") {
            // Clip long values + redact anything matching a known secret shape.
            const clipped = v.length > 256 ? v.slice(0, 256) : v;
            safe[k] = clipped.replace(SECRET_SHAPE, "[redacted]");
        }
        else {
            safe[k] = v;
        }
    }
    return safe;
}
/**
 * Writes one JSON line per event to `writer` (default `console.log`). Cloud
 * Logging turns each line into a structured LogEntry; locally the lines are
 * grep-friendly. One instance per composition root; keep it long-lived.
 */
export function createJsonLineMetrics(options = {}) {
    const writer = options.writer ?? ((line) => console.log(line));
    const clock = options.clock ?? (() => new Date().toISOString());
    const emit = (name, kind, value, labels) => {
        try {
            const line = JSON.stringify({
                metric: name,
                kind,
                value,
                labels: sanitizeLabels(labels),
                at: clock(),
            });
            writer(line);
        }
        catch {
            // Metrics are observability, never a failure path.
        }
    };
    return {
        counter(name, labels, value = 1) {
            emit(name, "counter", value, labels);
        },
        duration(name, ms, labels) {
            emit(name, "duration_ms", ms, labels);
        },
    };
}
/** No-op fallback for tests and compositions that haven't wired metrics. */
export const noopMetrics = Object.freeze({
    counter: () => { },
    duration: () => { },
});
