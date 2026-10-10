import { validateEnvironmentRequirement } from "../../contracts/index.js";
const CODE_REQUIREMENTS = {
    docker: {
        environmentType: "docker",
        requiredCapabilities: ["container_runtime_available"],
    },
    "vs-code": {
        environmentType: "visual_studio_code",
        requiredCapabilities: ["command_execution_available"],
    },
    "visual-studio": {
        environmentType: "visual_studio",
        requiredCapabilities: ["command_execution_available"],
    },
    "android-studio": {
        environmentType: "android_studio",
        requiredCapabilities: ["command_execution_available"],
    },
    xcode: {
        environmentType: "xcode",
        requiredCapabilities: [
            "command_execution_available",
            "mobile_build_capable",
        ],
        os: { os: "macos" },
    },
    unity: {
        environmentType: "unity",
        requiredCapabilities: ["command_execution_available", "game_build_capable"],
    },
    unreal: {
        environmentType: "unreal_engine",
        requiredCapabilities: ["command_execution_available", "game_build_capable"],
    },
};
export function createSoftwareFactoryEnvironmentProvider(router) {
    // The mapping table is authoritative and must always be well-formed.
    for (const requirement of Object.values(CODE_REQUIREMENTS)) {
        validateEnvironmentRequirement(requirement);
    }
    const requirementFor = (code) => {
        if (code === "none")
            return null;
        return CODE_REQUIREMENTS[code] ?? null;
    };
    return {
        requirementFor,
        route(codes) {
            return codes.map((code) => {
                if (code === "none") {
                    // `"none"` declares that NO environment is required. The
                    // orchestrator treats the literal code itself as eligible for
                    // dispatch — there is nothing to route or provision. This is a
                    // deterministic, safe placeholder outcome that the orchestrator
                    // ignores when it sees the literal `"none"` on the task.
                    return {
                        code,
                        requirement: null,
                        outcome: {
                            outcome: "NO_AVAILABLE_ENVIRONMENT",
                            reason: "none: no environment required",
                        },
                    };
                }
                const requirement = requirementFor(code);
                if (requirement === null) {
                    return {
                        code,
                        requirement: null,
                        outcome: {
                            outcome: "UNSUPPORTED",
                            reason: `environment code "${code}" is not supported`,
                        },
                    };
                }
                try {
                    return { code, requirement, outcome: router.route(requirement) };
                }
                catch (error) {
                    return {
                        code,
                        requirement,
                        outcome: {
                            outcome: "UNSUPPORTED",
                            reason: `environment code "${code}" could not be routed: ` +
                                (error instanceof Error ? error.message : String(error)),
                        },
                    };
                }
            });
        },
    };
}
