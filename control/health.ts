/**
 * System health — only what is actually measurable in-process.
 *
 * A `HealthProbe` returns the status of one component. The Control Plane never
 * *claims* an external provider is healthy: unless a probe has actually checked
 * it, its status is reported as `unknown` with an explicit "not checked" note.
 * `unknown` is not a failure — it means unmeasured.
 */
import {
  type HealthComponent,
  type HealthStatus,
  type SystemHealth,
} from "../contracts/index.js";
import { now } from "../core/index.js";

export interface HealthProbe {
  readonly name: string;
  check(): HealthStatus | { status: HealthStatus; detail: string };
}

/** A component that has not been wired to a real check. Honest by default. */
export function unverifiedComponent(
  name: string,
  detail = "not checked in this build",
): HealthProbe {
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
function worst(statuses: readonly HealthStatus[]): HealthStatus {
  if (statuses.includes("unavailable")) return "unavailable";
  if (statuses.includes("degraded")) return "degraded";
  if (statuses.includes("unknown")) return "unknown";
  return "healthy";
}

export function buildSystemHealth(
  probes: readonly HealthProbe[],
  clock: () => number = Date.now,
): SystemHealth {
  const checkedAt = new Date(clock()).toISOString();
  const components: HealthComponent[] = probes.map((probe) => {
    let result: HealthStatus | { status: HealthStatus; detail: string };
    try {
      result = probe.check();
    } catch (error) {
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
