import type { SecuritySystem } from "../security-governance/index.js";
import { SkillContextSource } from "./context-source.js";
import { ExtensionPlatform, type ExternalDependencyResolver, type ExtensionRepos } from "./registry.js";
export * from "./manifest.js";
export * from "./registry.js";
export * from "./builtins.js";
export * from "./context-source.js";
export declare const PLATFORM_VERSION = "1.0.0";
export declare function inMemoryExtensionRepos(): ExtensionRepos;
export declare class ExtensionSystem {
    readonly platform: ExtensionPlatform;
    readonly skillContext: SkillContextSource;
    constructor(o: {
        repos: ExtensionRepos;
        security: SecuritySystem;
        external?: ExternalDependencyResolver;
        now?: () => number;
        platformVersion?: string;
    });
    /** Idempotent: registers, tests and reviews each built-in once. */
    installBuiltins(by: string): number;
}
