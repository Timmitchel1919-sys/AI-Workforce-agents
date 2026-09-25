import type {
  EnvironmentRequirement,
  EnvironmentRoutingOutcome,
} from "./environments.js";

/**
 * Short, serializable codes a software-factory task may declare via
 * `Task.environmentRequirements`. Each code maps to a concrete
 * `EnvironmentRequirement` through `SoftwareFactoryEnvironmentProvider`.
 *
 * Routing never fabricates: a code without a usable, detected environment
 * resolves to a non-ROUTED outcome — the task is gated, not executed.
 *
 * The runtime never auto-executes on an unavailable environment. This is the
 * shared boundary between the software-factory orchestrator (backend) and the
 * environment stack (core/environments).
 */
export const SOFTWARE_FACTORY_ENVIRONMENT_CODES = [
  "none",
  "docker",
  "vs-code",
  "visual-studio",
  "android-studio",
  "xcode",
  "unity",
  "unreal",
] as const;
export type SoftwareFactoryEnvironmentCode =
  (typeof SOFTWARE_FACTORY_ENVIRONMENT_CODES)[number];

export interface EnvironmentCodeRoute {
  /**
   * The code as declared on the task. Task drafts submitted through the
   * Control Plane are restricted to {@link SOFTWARE_FACTORY_ENVIRONMENT_CODES};
   * internal callers may still pass any string, which resolves to
   * `UNSUPPORTED` rather than throwing.
   */
  code: string;
  /** The resolved, validated requirement; `null` when the code is unsupported. */
  requirement: EnvironmentRequirement | null;
  /**
   * Deterministic routing outcome. `ROUTED` requires a REAL usable instance
   * right now; `REQUIRES_PROVISIONING` means support exists but nothing is
   * usable yet; `NO_AVAILABLE_ENVIRONMENT` means no descriptor supports it.
   */
  outcome:
    EnvironmentRoutingOutcome | { outcome: "UNSUPPORTED"; reason: string };
}

/**
 * Port implemented by the environment stack (core/environments) and injected
 * into the software-factory orchestrator. Kept small so the orchestrator never
 * depends on registry internals or detectors.
 */
export interface SoftwareFactoryEnvironmentProvider {
  /** Maps a code to a validated requirement, or `null` when unsupported. */
  requirementFor(code: string): EnvironmentRequirement | null;
  /** Routes a list of codes in order. Never throws; each code is independent. */
  route(codes: readonly string[]): readonly EnvironmentCodeRoute[];
}
