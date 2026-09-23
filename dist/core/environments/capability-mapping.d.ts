/**
 * Deterministic capability fact table.
 *
 * Capabilities are derived ONLY from detection facts (probes that ran and
 * reported toolchains/detected environments). Rules here are intentionally
 * conservative: an operating system is never a capability source, and an
 * installed toolchain alone never implies a build capability unless the
 * environment that uses it was detected.
 */
import type { CapabilityDeclaration, CapabilityId, DetectedEnvironment, ToolchainDescriptor, ToolchainKind } from "../../contracts/index.js";
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
export declare function satisfiesToolchainRequirements(requirements: readonly {
    kind: ToolchainKind;
}[], toolchains: readonly ToolchainDescriptor[]): boolean;
