const CAPABILITY_RULES = [
    {
        capability: "command_execution_available",
        evidence: "probe execution succeeded on the host",
        // Any successful non-command probing implies the machine answers probes.
        requiresAnyEnvironmentType: [
            "visual_studio_code",
            "visual_studio",
            "xcode",
            "android_studio",
            "docker",
            "unity",
            "unreal_engine",
            "cli",
            "cloud_runner",
            "web_build",
            "desktop_build",
            "mobile_build",
            "game_build",
            "container_host",
        ],
    },
    {
        capability: "container_runtime_available",
        evidence: "docker environment detected",
        requiresAnyEnvironmentType: ["docker"],
    },
    {
        capability: "web_build_capable",
        evidence: "web build environment with a node toolchain detected",
        requiresToolchain: "node",
        requiresAnyEnvironmentTypeForToolchain: ["visual_studio_code", "web_build"],
    },
    {
        capability: "desktop_build_capable",
        evidence: "desktop build environment or compiler toolchain detected",
        requiresAnyEnvironmentType: ["desktop_build", "unity", "unreal_engine"],
    },
    {
        capability: "mobile_build_capable",
        evidence: "mobile build environment or mobile toolchain detected",
        requiresAnyEnvironmentType: ["xcode", "mobile_build", "android_studio"],
    },
    {
        capability: "game_build_capable",
        evidence: "game engine environment detected",
        requiresAnyEnvironmentType: ["unity", "unreal_engine"],
    },
    // gpu_available is deliberately never inferred from a toolchain or an OS.
];
/**
 * Derive a host capability report from detection facts. Declared facts are
 * merged after derived ones so operator-declared statements take precedence.
 */
export function deriveEnvironmentCapabilities(detected, declared = {}) {
    const result = new Map();
    // `detected: false` is a truthful, executed result — it never contributes.
    const present = detected.filter((d) => d.detected);
    const detectedTypes = new Set(present.map((d) => d.environmentType));
    const toolchainKinds = new Set();
    for (const env of present) {
        for (const toolchain of env.toolchains)
            toolchainKinds.add(toolchain.kind);
    }
    for (const toolchain of declared.toolchains ?? []) {
        toolchainKinds.add(toolchain.kind);
    }
    for (const rule of CAPABILITY_RULES) {
        let matched = false;
        if (rule.requiresAnyEnvironmentType) {
            matched = rule.requiresAnyEnvironmentType.some((type) => detectedTypes.has(type));
        }
        else if (rule.requiresToolchain &&
            rule.requiresAnyEnvironmentTypeForToolchain) {
            matched =
                toolchainKinds.has(rule.requiresToolchain) &&
                    rule.requiresAnyEnvironmentTypeForToolchain.some((type) => detectedTypes.has(type));
        }
        if (matched) {
            result.set(rule.capability, {
                capability: rule.capability,
                available: true,
                evidence: rule.evidence,
            });
        }
    }
    for (const statement of declared.capabilities ?? []) {
        result.set(statement.capability, { ...statement });
    }
    return [...result.values()];
}
/** True when every required capability is satisfied by the declared set. */
export function capabilitiesSatisfied(required, declared) {
    if (required.length === 0)
        return true;
    const byId = new Map(declared.map((d) => [d.capability, d.available]));
    return required.every((capability) => byId.get(capability) === true);
}
export function hasToolchain(kind, toolchains) {
    return toolchains.some((t) => t.kind === kind);
}
export function satisfiesToolchainRequirements(requirements, toolchains) {
    return requirements.every((req) => hasToolchain(req.kind, toolchains));
}
