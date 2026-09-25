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
];
