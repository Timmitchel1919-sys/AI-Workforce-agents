/**
 * Deterministic capability fact table.
 *
 * Capabilities are derived ONLY from detection facts (probes that ran and
 * reported toolchains/detected environments). Rules here are intentionally
 * conservative: an operating system is never a capability source, and an
 * installed toolchain alone never implies a build capability unless the
 * environment that uses it was detected.
 */
import {
  versionAtLeast,
  type CapabilityDeclaration,
  type CapabilityId,
  type DetectedEnvironment,
  type ToolchainDescriptor,
  type ToolchainKind,
  type ToolchainRequirement,
} from "../../contracts/index.js";

export interface DeclaredFacts {
  /** Capabilities declared by the operator/host owner (highest trust). */
  capabilities?: readonly CapabilityDeclaration[];
  /** Toolchains declared by the operator/host owner (trusted compiled input). */
  toolchains?: readonly ToolchainDescriptor[];
}

/** A capability + the evidence label used when it becomes available. */
interface CapabilityRule {
  capability: CapabilityId;
  evidence: string;
  /** True when any detected environment has this toolchain kind. */
  requiresToolchain?: ToolchainKind;
  /** True when any detected environment is one of these types. */
  requiresAnyEnvironmentType?: readonly EnvironmentTypeLike[];
  /** When set, requires the `requiresToolchain` to coexist with this type. */
  requiresAnyEnvironmentTypeForToolchain?: readonly EnvironmentTypeLike[];
}

type EnvironmentTypeLike = DetectedEnvironment["environmentType"];

const CAPABILITY_RULES: readonly CapabilityRule[] = [
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
export function deriveEnvironmentCapabilities(
  detected: readonly DetectedEnvironment[],
  declared: DeclaredFacts = {},
): CapabilityDeclaration[] {
  const result = new Map<CapabilityId, CapabilityDeclaration>();
  // `detected: false` is a truthful, executed result — it never contributes.
  const present = detected.filter((d) => d.detected);
  const detectedTypes = new Set(present.map((d) => d.environmentType));
  const toolchainKinds = new Set<ToolchainKind>();
  for (const env of present) {
    for (const toolchain of env.toolchains) toolchainKinds.add(toolchain.kind);
  }
  for (const toolchain of declared.toolchains ?? []) {
    toolchainKinds.add(toolchain.kind);
  }

  for (const rule of CAPABILITY_RULES) {
    let matched = false;
    if (rule.requiresAnyEnvironmentType) {
      matched = rule.requiresAnyEnvironmentType.some((type) =>
        detectedTypes.has(type),
      );
    } else if (
      rule.requiresToolchain &&
      rule.requiresAnyEnvironmentTypeForToolchain
    ) {
      matched =
        toolchainKinds.has(rule.requiresToolchain) &&
        rule.requiresAnyEnvironmentTypeForToolchain.some((type) =>
          detectedTypes.has(type),
        );
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
export function capabilitiesSatisfied(
  required: readonly CapabilityId[],
  declared: readonly CapabilityDeclaration[],
): boolean {
  if (required.length === 0) return true;
  const byId = new Map(declared.map((d) => [d.capability, d.available]));
  return required.every((capability) => byId.get(capability) === true);
}

export function hasToolchain(
  kind: ToolchainKind,
  toolchains: readonly ToolchainDescriptor[],
): boolean {
  return toolchains.some((t) => t.kind === kind);
}

/** Why a toolchain requirement is not met by a set of detected toolchains. */
export interface ToolchainShortfall {
  /** `kind` or `kind:component`. */
  label: string;
  reason:
    | "missing_toolchain"
    | "toolchain_version_too_low"
    | "missing_toolchain_component"
    | "toolchain_component_version_too_low";
}

/**
 * Every unmet toolchain requirement, including minimum versions and named
 * components. A requirement is met when ANY detected toolchain of that kind
 * satisfies it completely; the reported shortfall is the closest candidate's.
 */
export function toolchainShortfalls(
  requirements: readonly ToolchainRequirement[],
  toolchains: readonly ToolchainDescriptor[],
): ToolchainShortfall[] {
  const shortfalls: ToolchainShortfall[] = [];
  for (const requirement of requirements) {
    const sameKind = toolchains.filter((t) => t.kind === requirement.kind);
    if (sameKind.length === 0) {
      shortfalls.push({ label: requirement.kind, reason: "missing_toolchain" });
      continue;
    }
    const perCandidate = sameKind.map((t) => shortfallFor(requirement, t));
    if (perCandidate.some((list) => list.length === 0)) continue;
    perCandidate.sort((a, b) => a.length - b.length);
    shortfalls.push(...perCandidate[0]!);
  }
  return shortfalls;
}

function shortfallFor(
  requirement: ToolchainRequirement,
  toolchain: ToolchainDescriptor,
): ToolchainShortfall[] {
  const out: ToolchainShortfall[] = [];
  if (
    requirement.minimum !== undefined &&
    !versionAtLeast(toolchain.version, requirement.minimum)
  ) {
    out.push({
      label: requirement.kind,
      reason: "toolchain_version_too_low",
    });
  }
  for (const component of requirement.components ?? []) {
    const label = `${requirement.kind}:${component.name}`;
    const detected = toolchain.componentVersions?.[component.name];
    if (detected === undefined) {
      out.push({ label, reason: "missing_toolchain_component" });
    } else if (
      component.minimum !== undefined &&
      !versionAtLeast(detected, component.minimum)
    ) {
      out.push({ label, reason: "toolchain_component_version_too_low" });
    }
  }
  return out;
}

/**
 * True when every toolchain requirement — kind, minimum version and named
 * components — is satisfied. (EO-2A checked `kind` only; the minimum version
 * is enforced since EO-3.1.)
 */
export function satisfiesToolchainRequirements(
  requirements: readonly ToolchainRequirement[],
  toolchains: readonly ToolchainDescriptor[],
): boolean {
  return toolchainShortfalls(requirements, toolchains).length === 0;
}
