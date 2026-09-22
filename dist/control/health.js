import { now } from "../core/index.js";
/** A component that has not been wired to a real check. Honest by default. */
export function unverifiedComponent(name, detail = "not checked in this build") {
    return {
        name,
        check: () => ({ status: "unknown", detail }),
    };
}
/**
 * Overall = the worst component. Precedence:
 *   unavailable > degraded > unknown > healthy
 * An unmeasured component drags the overall status down to `unknown`, but not
 * to `degraded` — the system is not known to be impaired, only not fully
 * observed.
 */
function worst(statuses) {
    if (statuses.includes("unavailable"))
        return "unavailable";
    if (statuses.includes("degraded"))
        return "degraded";
    if (statuses.includes("unknown"))
        return "unknown";
    return "healthy";
}
export function buildSystemHealth(probes, clock = Date.now) {
    const checkedAt = new Date(clock()).toISOString();
    const components = probes.map((probe) => {
        let result;
        try {
            result = probe.check();
        }
        catch (error) {
            result = {
                status: "unavailable",
                detail: error instanceof Error ? error.message : String(error),
            };
        }
        return typeof result === "string"
            ? { name: probe.name, status: result, detail: "ok", checkedAt }
            : {
                name: probe.name,
                status: result.status,
                detail: result.detail,
                checkedAt,
            };
    });
    return {
        status: worst(components.map((c) => c.status)),
        generatedAt: now(),
        components,
    };
}
