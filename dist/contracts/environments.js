/**
 * Environment Orchestration contracts — the EO-1 / EO-2A shared vocabulary.
 *
 * These are pure types and validators with NO dependency on any probe, tool,
 * operating-system API, shell, or infrastructure. The definitions here separate
 * the five concepts the foundation is built on:
 *
 *   Architecture | EnvironmentDescriptor (type support) – what we *can* support
 *     vs        | EnvironmentInstance       – what is *installed*
 *   Environment | Host                      – the machine
 *   Capability  | CapabilityDeclaration     – whether a host can perform a task
 *   Readiness   | Availability              – whether it is currently usable
 *
 * Detection is deterministic: capability and availability are never inferred
 * from the operating system alone. Nothing here stores a credential, a secret,
 * a shell command supplied by a caller, or a chain-of-thought trace.
 */
import { requireArray, requireText, ValidationError } from "./index.js";
export function parseVersion(value) {
    if (typeof value !== "string")
        return undefined;
    const v = value.trim();
    if (v === "")
        return undefined;
    // Optional semver-ish: "20", "20.11", "20.11.1", with optional -pre +build.
    const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/.exec(v);
    if (!match)
        return undefined;
    return {
        major: Number(match[1]),
        minor: Number(match[2] ?? "0"),
        patch: Number(match[3] ?? "0"),
        preRelease: match[4],
        build: match[5],
    };
}
export function formatVersion(version) {
    const base = `${version.major}.${version.minor}.${version.patch}`;
    const pre = version.preRelease ? `-${version.preRelease}` : "";
    const build = version.build ? `+${version.build}` : "";
    return `${base}${pre}${build}`;
}
/** Numeric ordering on major/minor/patch only — pre-release/build are ignored. */
export function versionAtLeast(actual, minimum) {
    if (!actual)
        return false;
    return (actual.major > minimum.major ||
        (actual.major === minimum.major &&
            (actual.minor > minimum.minor ||
                (actual.minor === minimum.minor && actual.patch >= minimum.patch))));
}
/**
 * Total order on major/minor/patch; an absent version sorts lowest.
 * Returns a negative number when `a < b`, positive when `a > b`, else 0.
 */
export function compareVersions(a, b) {
    if (!a && !b)
        return 0;
    if (!a)
        return -1;
    if (!b)
        return 1;
    return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}
/* ------------------------------------------------------------------ */
/* Operating system                                                   */
/* ------------------------------------------------------------------ */
export const OS_NAMES = ["windows", "macos", "linux"];
export const ARCHITECTURES = [
    "x64",
    "arm64",
    "x86",
    "arm",
    "universal",
    "unknown",
];
export function validateOperatingSystem(os, field = "os") {
    if (!os || typeof os !== "object") {
        throw new ValidationError(`${field} must be an object`);
    }
    if (!OS_NAMES.includes(os.os)) {
        throw new ValidationError(`${field}.os must be one of ${OS_NAMES.join(", ")}`);
    }
    if (!ARCHITECTURES.includes(os.architecture)) {
        throw new ValidationError(`${field}.architecture must be one of ${ARCHITECTURES.join(", ")}`);
    }
    if (os.version !== undefined && typeof os.version !== "string") {
        throw new ValidationError(`${field}.version must be a string`);
    }
}
/* ------------------------------------------------------------------ */
/* Host                                                               */
/* ------------------------------------------------------------------ */
export const HOST_TYPES = [
    "local_workstation",
    "dedicated_runner",
    "cloud_runner",
    "container_host",
    "mac_build_host",
];
export const TRUST_LEVELS = ["declared", "detected", "verified"];
export const AVAILABILITIES = [
    "available",
    "unavailable",
    "degraded",
    "disabled",
];
/* ------------------------------------------------------------------ */
/* Capabilities                                                       */
/* ------------------------------------------------------------------ */
export const CAPABILITY_IDS = [
    "command_execution_available",
    "container_runtime_available",
    "web_build_capable",
    "desktop_build_capable",
    "mobile_build_capable",
    "game_build_capable",
    "gpu_available",
];
export function validateCapabilityDeclaration(statement, field = "capability") {
    if (!statement || typeof statement !== "object") {
        throw new ValidationError(`${field} must be an object`);
    }
    if (!CAPABILITY_IDS.includes(statement.capability)) {
        throw new ValidationError(`${field}.capability is not a known capability`);
    }
    if (typeof statement.available !== "boolean") {
        throw new ValidationError(`${field}.available must be a boolean`);
    }
}
/* ------------------------------------------------------------------ */
/* Toolchains                                                         */
/* ------------------------------------------------------------------ */
export const TOOLCHAIN_KINDS = [
    "node",
    "dotnet",
    "swift_xcode",
    "jdk_gradle",
    "android_sdk",
    "cpp_compiler",
    "unity",
    "unreal",
    "python",
    "rust",
    "go",
    "dart",
];
/* ------------------------------------------------------------------ */
/* Environment descriptor vs instance                                 */
/* ------------------------------------------------------------------ */
export const ENVIRONMENT_TYPES = [
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
];
/** Machine-readable reasons an instance was rejected for a requirement. */
export const ENVIRONMENT_REJECTION_REASONS = [
    "instance_unavailable",
    "host_unavailable",
    "host_unknown",
    "descriptor_mismatch",
    "environment_type_mismatch",
    "os_mismatch",
    "architecture_mismatch",
    "trust_too_low",
    "missing_capability",
    "missing_toolchain",
    "toolchain_version_too_low",
    "missing_toolchain_component",
    "toolchain_component_version_too_low",
];
/* ------------------------------------------------------------------ */
/* Validators                                                         */
/* ------------------------------------------------------------------ */
export function validateToolchainDescriptor(toolchain, field = "toolchain") {
    requireText(toolchain.name, `${field}.name`);
    if (!TOOLCHAIN_KINDS.includes(toolchain.kind)) {
        throw new ValidationError(`${field}.kind is not a known toolchain kind`);
    }
    if (toolchain.version !== undefined) {
        const parsed = parseVersion(formatVersion(toolchain.version));
        if (!parsed) {
            throw new ValidationError(`${field}.version is not a valid version`);
        }
    }
}
export function validateToolchainRequirement(requirement, field = "toolchain") {
    if (!TOOLCHAIN_KINDS.includes(requirement.kind)) {
        throw new ValidationError(`${field}.kind is not a known toolchain kind`);
    }
    if (requirement.components !== undefined) {
        requireArray(requirement.components, `${field}.components`);
        requirement.components.forEach((component, index) => requireText(component?.name, `${field}.components[${index}].name`));
    }
}
export function validateHostDescriptor(host) {
    requireText(host.id, "host.id");
    requireText(host.name, "host.name");
    if (!HOST_TYPES.includes(host.hostType)) {
        throw new ValidationError(`host.hostType must be one of ${HOST_TYPES.join(", ")}`);
    }
    validateOperatingSystem(host.os, "host.os");
    if (!TRUST_LEVELS.includes(host.trustLevel)) {
        throw new ValidationError(`host.trustLevel must be one of ${TRUST_LEVELS.join(", ")}`);
    }
}
export function validateHostInstance(host) {
    validateHostDescriptor(host);
    requireText(host.hostId, "host.hostId");
    requireText(host.fingerprint, "host.fingerprint");
    if (!AVAILABILITIES.includes(host.availability)) {
        throw new ValidationError(`host.availability must be one of ${AVAILABILITIES.join(", ")}`);
    }
    requireArray(host.capabilities, "host.capabilities");
    host.capabilities.forEach((c, index) => validateCapabilityDeclaration(c, `host.capabilities[${index}]`));
}
export function validateEnvironmentDescriptor(descriptor) {
    requireText(descriptor.id, "descriptor.id");
    requireText(descriptor.name, "descriptor.name");
    requireText(descriptor.description, "descriptor.description");
    if (!ENVIRONMENT_TYPES.includes(descriptor.environmentType)) {
        throw new ValidationError(`descriptor.environmentType is not a known environment type`);
    }
    requireArray(descriptor.supportedToolchains, "descriptor.supportedToolchains");
    descriptor.supportedToolchains.forEach((t, index) => validateToolchainRequirement(t, `descriptor.supportedToolchains[${index}]`));
    requireArray(descriptor.requiredCapabilities, "descriptor.requiredCapabilities");
    descriptor.requiredCapabilities.forEach((c, index) => {
        if (!CAPABILITY_IDS.includes(c)) {
            throw new ValidationError(`descriptor.requiredCapabilities[${index}] is not a known capability`);
        }
    });
    descriptor.declaredCapabilities?.forEach((c) => {
        if (!CAPABILITY_IDS.includes(c)) {
            throw new ValidationError("descriptor.declaredCapabilities contains an unknown capability");
        }
    });
    if (descriptor.minimumOs !== undefined) {
        if (descriptor.minimumOs.os !== undefined &&
            !OS_NAMES.includes(descriptor.minimumOs.os)) {
            throw new ValidationError("descriptor.minimumOs.os is not a known OS");
        }
        if (descriptor.minimumOs.architecture !== undefined &&
            !ARCHITECTURES.includes(descriptor.minimumOs.architecture)) {
            throw new ValidationError("descriptor.minimumOs.architecture is not a known architecture");
        }
    }
}
export function validateEnvironmentInstance(instance) {
    requireText(instance.id, "instance.id");
    requireText(instance.descriptorId, "instance.descriptorId");
    requireText(instance.hostId, "instance.hostId");
    requireText(instance.name, "instance.name");
    requireText(instance.fingerprint, "instance.fingerprint");
    if (!ENVIRONMENT_TYPES.includes(instance.environmentType)) {
        throw new ValidationError("instance.environmentType is not known");
    }
    if (!AVAILABILITIES.includes(instance.availability)) {
        throw new ValidationError(`instance.availability must be one of ${AVAILABILITIES.join(", ")}`);
    }
    if (!TRUST_LEVELS.includes(instance.trustLevel)) {
        throw new ValidationError(`instance.trustLevel must be one of ${TRUST_LEVELS.join(", ")}`);
    }
    requireArray(instance.capabilities, "instance.capabilities");
    instance.capabilities.forEach((c, index) => validateCapabilityDeclaration(c, `instance.capabilities[${index}]`));
    requireArray(instance.toolchains, "instance.toolchains");
    instance.toolchains.forEach((t, index) => validateToolchainDescriptor(t, `instance.toolchains[${index}]`));
}
export function validateDetectedEnvironment(detected) {
    if (!ENVIRONMENT_TYPES.includes(detected.environmentType)) {
        throw new ValidationError("detected.environmentType is not known");
    }
    if (typeof detected.detected !== "boolean") {
        throw new ValidationError("detected.detected must be a boolean");
    }
    if (!AVAILABILITIES.includes(detected.availability) &&
        detected.availability !== undefined) {
        throw new ValidationError("detected.availability is not known");
    }
    requireArray(detected.evidence, "detected.evidence");
    requireArray(detected.warnings, "detected.warnings");
    requireArray(detected.toolchains, "detected.toolchains");
    detected.toolchains.forEach((t, index) => validateToolchainDescriptor(t, `detected.toolchains[${index}]`));
    if (typeof detected.confidence !== "number" ||
        detected.confidence < 0 ||
        detected.confidence > 1) {
        throw new ValidationError("detected.confidence must be a number between 0 and 1");
    }
}
export function validateCommandProbeDefinition(definition) {
    requireText(definition.id, "probe.id");
    requireText(definition.executable, "probe.executable");
    // Bare executable basename only — rejects paths, shell metacharacters, "..".
    if (!/^[A-Za-z0-9._-]+$/.test(definition.executable)) {
        throw new ValidationError("probe.executable must be a bare executable basename");
    }
    if (definition.executable === "." || definition.executable === "..") {
        throw new ValidationError("probe.executable must not be a dot path");
    }
    requireArray(definition.arguments, "probe.arguments");
    definition.arguments.forEach((arg) => {
        if (typeof arg !== "string") {
            throw new ValidationError("probe.arguments must be strings");
        }
    });
    if (!Number.isFinite(definition.timeoutMs) || definition.timeoutMs <= 0) {
        throw new ValidationError("probe.timeoutMs must be a positive number");
    }
    if (!Number.isFinite(definition.maxOutputBytes) ||
        definition.maxOutputBytes <= 0) {
        throw new ValidationError("probe.maxOutputBytes must be a positive number");
    }
    definition.allowedExitCodes?.forEach((code) => {
        if (!Number.isInteger(code)) {
            throw new ValidationError("probe.allowedExitCodes must be integers");
        }
    });
}
export function validateEnvironmentRequirement(requirement) {
    if (!requirement || typeof requirement !== "object") {
        throw new ValidationError("environment requirement must be an object");
    }
    if (requirement.descriptorId === undefined &&
        requirement.environmentType === undefined &&
        requirement.requiredCapabilities === undefined &&
        requirement.toolchains === undefined) {
        throw new ValidationError("environment requirement must name a descriptor, type, capability, or toolchain");
    }
    requirement.requiredCapabilities?.forEach((c) => {
        if (!CAPABILITY_IDS.includes(c)) {
            throw new ValidationError("environment requirement references an unknown capability");
        }
    });
    requirement.toolchains?.forEach((t, index) => validateToolchainRequirement(t, `requirement.toolchains[${index}]`));
    if (requirement.os !== undefined) {
        if (requirement.os.os !== undefined &&
            !OS_NAMES.includes(requirement.os.os)) {
            throw new ValidationError("environment requirement os is not known");
        }
        if (requirement.os.architecture !== undefined &&
            !ARCHITECTURES.includes(requirement.os.architecture)) {
            throw new ValidationError("environment requirement architecture is not known");
        }
    }
    if (requirement.minimumTrust !== undefined &&
        !TRUST_LEVELS.includes(requirement.minimumTrust)) {
        throw new ValidationError("environment requirement trust is not known");
    }
}
