/**
 * Deterministic capability fact table.
 *
 * Capabilities are derived ONLY from detection facts (probes that ran and
 * reported toolchains/detected environments). Rules here are intentionally
 * conservative: an operating system is never a capability source, and an
 * installed toolchain alone never implies a build capability unless the
 * environment that uses it was detected.
 */
import { type CapabilityDeclaration, type CapabilityId, type DetectedEnvironment, type ToolchainDescriptor, type ToolchainKind, type ToolchainRequirement } from "../../contracts/index.js";
export interface DeclaredFacts {
    /** Capabilities declared by the operator/host owner (highest trust). */
    capabilities?: readonly CapabilityDeclaration[];
    /** Toolchains declared by the operator/host owner (trusted compiled input). */
    toolchains?: readonly ToolchainDescriptor[];
}
/**
 * Derive a host capability report from detection facts. Declared facts are
 * merged after derived ones so operator-declared statements take precedence.
 */
export declare function deriveEnvironmentCapabilities(detected: readonly DetectedEnvironment[], declared?: DeclaredFacts): CapabilityDeclaration[];
/** True when every required capability is satisfied by the declared set. */
export declare function capabilitiesSatisfied(required: readonly CapabilityId[], declared: readonly CapabilityDeclaration[]): boolean;
export declare function hasToolchain(kind: ToolchainKind, toolchains: readonly ToolchainDescriptor[]): boolean;
/** Why a toolchain requirement is not met by a set of detected toolchains. */
export interface ToolchainShortfall {
    /** `kind` or `kind:component`. */
    label: string;
    reason: "missing_toolchain" | "toolchain_version_too_low" | "missing_toolchain_component" | "toolchain_component_version_too_low";
}
/**
 * Every unmet toolchain requirement, including minimum versions and named
 * components. A requirement is met when ANY detected toolchain of that kind
 * satisfies it completely; the reported shortfall is the closest candidate's.
 */
export declare function toolchainShortfalls(requirements: readonly ToolchainRequirement[], toolchains: readonly ToolchainDescriptor[]): ToolchainShortfall[];
/**
 * True when every toolchain requirement — kind, minimum version and named
 * components — is satisfied. (EO-2A checked `kind` only; the minimum version
 * is enforced since EO-3.1.)
 */
export declare function satisfiesToolchainRequirements(requirements: readonly ToolchainRequirement[], toolchains: readonly ToolchainDescriptor[]): boolean;
