/**
 * EO-4.5 platform execution adapters. This is the ONLY place that knows
 * platform facts (Xcode needs macOS, Android needs JDK + Android SDK, Unity
 * modules, Unreal compilers, container daemons). Every decision is taken
 * from authoritative EO-2 discovery metadata — never from display names
 * ("Visual Studio PC") and never from a request.
 *
 * IDE ≠ TOOLCHAIN: there is no Visual Studio / VS Code / Android Studio
 * adapter. Projects edited in an IDE route to the family of the underlying
 * toolchain (.NET SDK / MSBuild, Node, JDK + Gradle + Android SDK, Xcode).
 *
 * Adapters evaluate; they never execute. Runners execute.
 */
import { evaluateContainerRequest, evaluateDistribution, evaluateGpu, evaluateTargets, evaluateToolchains, readExecutionDiscovery, } from "../../contracts/index.js";
function defineAdapter(def) {
    return {
        adapterId: def.adapterId,
        version: "1.0.0",
        family: def.family,
        description: def.description,
        executables: def.executables,
        evaluate(ctx, requirement) {
            const reasons = [];
            if (requirement.family !== def.family) {
                reasons.push({
                    code: "ADAPTER_ERROR",
                    detail: `the ${def.adapterId} adapter serves ${def.family}, not ${requirement.family}`,
                });
            }
            if (def.hostOs && !def.hostOs.includes(ctx.host.os.os)) {
                reasons.push({
                    code: "PLATFORM_MISMATCH",
                    detail: `${def.family} execution requires a ${def.hostOs.join("/")} host (found ${ctx.host.os.os})`,
                });
            }
            if (def.environmentTypes &&
                !def.environmentTypes.includes(ctx.instance.environmentType)) {
                reasons.push({
                    code: "PLATFORM_MISMATCH",
                    detail: `environment type ${ctx.instance.environmentType} is not driven by the ${def.adapterId} adapter`,
                });
            }
            for (const kind of def.baseToolchains ?? []) {
                if (!ctx.instance.toolchains.some((t) => t.kind === kind)) {
                    reasons.push({
                        code: "TOOLCHAIN_MISSING",
                        detail: `${def.family} execution requires the ${kind} toolchain`,
                    });
                }
            }
            const toolchains = evaluateToolchains(ctx.instance, requirement);
            reasons.push(...toolchains.reasons);
            const extraTargets = new Set(def.targetEvidence?.(ctx) ?? []);
            reasons.push(...evaluateTargets(ctx.instance, {
                ...requirement,
                targets: (requirement.targets ?? []).filter((t) => !extraTargets.has(t)),
            }));
            reasons.push(...evaluateGpu(ctx.instance, requirement));
            reasons.push(...evaluateDistribution(requirement));
            reasons.push(...(def.extra?.(ctx, requirement) ?? []));
            // Deduplicate identical reasons (deterministic order kept).
            const seen = new Set();
            const unique = reasons.filter((r) => {
                const key = `${r.code}|${r.detail}`;
                if (seen.has(key))
                    return false;
                seen.add(key);
                return true;
            });
            return {
                eligible: unique.length === 0,
                reasons: unique,
                toolchains: toolchains.observed,
            };
        },
    };
}
/** Windows: .NET SDK / MSBuild / Node / Windows packaging (no cmd, no PowerShell). */
export function createWindowsAdapter() {
    return defineAdapter({
        adapterId: "windows-toolchain",
        family: "windows",
        description: "Windows toolchains (.NET SDK, MSBuild, Node) through registered operations; Visual Studio projects route here via the .NET SDK — never via IDE automation.",
        executables: ["dotnet", "msbuild", "node"],
        hostOs: ["windows"],
    });
}
/** macOS: Xcode / Swift / Apple SDKs. Apple targets need discovered SDKs. */
export function createMacosXcodeAdapter() {
    return defineAdapter({
        adapterId: "macos-xcode",
        family: "macos",
        description: "Native Apple builds with the Xcode toolchain on an eligible macOS host. Signing and distribution are separate protected capabilities.",
        executables: ["xcodebuild", "swift", "node"],
        hostOs: ["macos"],
        // An installed `<platform>_sdk` Xcode component proves that target.
        targetEvidence: (ctx) => Object.keys(ctx.instance.toolchains.find((t) => t.kind === "swift_xcode")
            ?.componentVersions ?? {})
            .filter((name) => name.endsWith("_sdk"))
            .map((name) => name.slice(0, -"_sdk".length)),
    });
}
/** Android: JDK + Gradle + Android SDK are all required. */
export function createAndroidAdapter() {
    return defineAdapter({
        adapterId: "android-gradle",
        family: "android",
        description: "Android builds through registered Gradle profiles (JDK + Android SDK). APK/AAB signing and Play publishing are never implied.",
        executables: ["gradle", "java"],
        baseToolchains: ["jdk_gradle", "android_sdk"],
    });
}
/** Linux: backend/web/CLI builds (no unrestricted Bash). */
export function createLinuxAdapter() {
    return defineAdapter({
        adapterId: "linux-toolchain",
        family: "linux",
        description: "Linux toolchains (Node, Python, Go, Rust, C/C++) through registered operations.",
        executables: ["node", "python", "go", "cargo", "make"],
        hostOs: ["linux"],
    });
}
/**
 * Docker: descriptor exists ≠ executable present ≠ daemon operational ≠
 * container execution authorized. Every workload passes the container
 * policy (no privileged, host network/PID, socket, devices, host mounts).
 */
export function createDockerAdapter(policy) {
    return defineAdapter({
        adapterId: "docker-container",
        family: "docker",
        description: "Bounded container workloads with approved images, symbolic workspace mounts and policy-controlled networking.",
        executables: ["docker"],
        extra: (ctx, requirement) => {
            const reasons = [];
            const runtime = ctx.instance.capabilities.some((c) => c.capability === "container_runtime_available" && c.available);
            if (!runtime) {
                reasons.push({
                    code: "TOOLCHAIN_MISSING",
                    detail: "no container runtime was discovered on this environment",
                });
            }
            else if (readExecutionDiscovery(ctx.instance).containerDaemon !== "operational") {
                reasons.push({
                    code: "ENVIRONMENT_OFFLINE",
                    detail: "the container daemon is not operational (runtime known ≠ execution ready)",
                });
            }
            if (!requirement.container) {
                reasons.push({
                    code: "ADAPTER_ERROR",
                    detail: "container operations must declare a container request",
                });
            }
            else {
                reasons.push(...evaluateContainerRequest(requirement.container, policy));
            }
            return reasons;
        },
    });
}
/**
 * Provider-neutral cloud runner contract: provision/lease, verify identity
 * (registry), prepare workspace, run bounded operations, collect declared
 * artifacts, terminate. Bound to no vendor.
 */
export function createCloudRunnerAdapter(executables = ["node"]) {
    return defineAdapter({
        adapterId: "cloud-runner",
        family: "cloud",
        description: "Provider-neutral remote runners with verified identity, leases and heartbeats. No endpoint is ever taken from a request.",
        executables,
        environmentTypes: ["cloud_runner"],
        extra: (ctx) => ctx.host.hostType === "cloud_runner"
            ? []
            : [
                {
                    code: "PLATFORM_MISMATCH",
                    detail: "the host is not a registered cloud runner",
                },
            ],
    });
}
/** Unity: exact editor version + discovered build modules, batch mode only. */
export function createUnityAdapter() {
    return defineAdapter({
        adapterId: "unity-editor",
        family: "unity",
        description: "Unity batch-mode builds/tests with explicit editor version matching and discovered target modules.",
        executables: ["unity"],
        baseToolchains: ["unity"],
        extra: (_ctx, requirement) => requirement.exactVersions?.some((v) => v.kind === "unity")
            ? []
            : [
                {
                    code: "ADAPTER_ERROR",
                    detail: "Unity operations must pin an editor version explicitly",
                },
            ],
    });
}
/** Unreal: exact engine version + C++ compiler + target platform SDKs. */
export function createUnrealAdapter() {
    return defineAdapter({
        adapterId: "unreal-engine",
        family: "unreal",
        description: "Unreal Engine builds/automation tests with explicit engine versions, a C++ toolchain and discovered platform SDKs. Projects are never migrated.",
        executables: ["unreal-uat"],
        baseToolchains: ["unreal", "cpp_compiler"],
        extra: (_ctx, requirement) => requirement.exactVersions?.some((v) => v.kind === "unreal")
            ? []
            : [
                {
                    code: "ADAPTER_ERROR",
                    detail: "Unreal operations must pin an engine version explicitly",
                },
            ],
    });
}
/** Every platform adapter (contracts). Runners are registered separately. */
export function createPlatformAdapters(options) {
    return [
        createWindowsAdapter(),
        createMacosXcodeAdapter(),
        createAndroidAdapter(),
        createLinuxAdapter(),
        createDockerAdapter(options.containerPolicy),
        createCloudRunnerAdapter(options.cloudExecutables),
        createUnityAdapter(),
        createUnrealAdapter(),
    ];
}
