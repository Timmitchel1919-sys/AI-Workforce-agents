/**
 * Technology catalog — the declarative REQUIREMENT table for planning.
 *
 * Each row states what a technology REQUIRES (toolchains, minimum versions,
 * components, host OS, host capabilities, agent qualifications, model
 * capabilities, planned test types). It never states that anything is
 * AVAILABLE — availability comes only from the Environment Registry.
 *
 * Capability-driven: planning looks technologies up by id and combines their
 * requirements. There is no `if (ios) … else if (android) …` chain; supporting a
 * new technology means adding a row (or registering a catalog of your own).
 */
import { type ArtifactSpec, type CapabilityId, type ComponentKind, type ModelCapability, type OsName, type TargetPlatform, type TestType, type ToolchainKind, type ToolchainRequirement } from "../../contracts/index.js";
export interface TechnologyProfile {
    id: string;
    label: string;
    /** Component kinds this technology can implement. */
    componentKinds: readonly ComponentKind[];
    /** Target platforms this technology can produce. */
    platforms: readonly TargetPlatform[];
    toolchains: readonly ToolchainRequirement[];
    /**
     * Per-target-platform components of one toolchain (e.g. Unity build
     * modules, Unreal platform packages). Only the component's platforms apply.
     */
    platformComponents?: {
        toolchain: ToolchainKind;
        byPlatform: Partial<Record<TargetPlatform, string>>;
    };
    /** `from` depends on `to` — both must be toolchains of this profile. */
    toolchainDependencies?: readonly {
        from: ToolchainKind;
        to: ToolchainKind;
    }[];
    os?: {
        os?: OsName;
    };
    capabilities: readonly CapabilityId[];
    agentCapabilities: readonly string[];
    modelCapabilities: readonly ModelCapability[];
    testTypes: readonly TestType[];
    /** Static analysis is meaningful for this technology's languages. */
    sast: boolean;
    artifact: ArtifactSpec;
}
/** Bump when a profile changes so replans detect catalog changes. */
export declare const TECHNOLOGY_CATALOG_VERSION = "2026-09-23.1";
export declare const TECHNOLOGY_PROFILES: readonly TechnologyProfile[];
/** Lookup over a validated set of profiles. Injectable for tests/extensions. */
export declare class TechnologyCatalog {
    readonly version: string;
    private readonly byId;
    constructor(profiles?: readonly TechnologyProfile[], version?: string);
    get(id: string): TechnologyProfile | undefined;
    list(): TechnologyProfile[];
}
