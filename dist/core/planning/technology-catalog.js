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
import { ValidationError, } from "../../contracts/index.js";
const v = (major, minor = 0, patch = 0) => ({ major, minor, patch });
/** Bump when a profile changes so replans detect catalog changes. */
export const TECHNOLOGY_CATALOG_VERSION = "2026-09-23.1";
export const TECHNOLOGY_PROFILES = [
    {
        id: "react_typescript",
        label: "React + TypeScript",
        componentKinds: ["web_frontend"],
        platforms: ["web"],
        toolchains: [
            { kind: "node", minimum: v(20), components: [{ name: "npm" }] },
        ],
        capabilities: ["web_build_capable"],
        agentCapabilities: ["web_development"],
        modelCapabilities: ["coding", "reasoning"],
        testTypes: ["unit", "ui", "e2e", "build_verification"],
        sast: true,
        artifact: { kind: "static_web_bundle", name: "web-dist" },
    },
    {
        id: "node_backend",
        label: "Node.js service",
        componentKinds: ["backend_service", "library"],
        platforms: ["linux", "windows", "macos"],
        toolchains: [
            { kind: "node", minimum: v(20), components: [{ name: "npm" }] },
        ],
        capabilities: ["command_execution_available"],
        agentCapabilities: ["backend_development"],
        modelCapabilities: ["coding", "reasoning"],
        testTypes: ["unit", "integration", "build_verification"],
        sast: true,
        artifact: { kind: "node_package", name: "service-dist" },
    },
    {
        id: "dotnet_aspnet",
        label: "ASP.NET Core service",
        componentKinds: ["backend_service", "library"],
        platforms: ["linux", "windows", "macos"],
        toolchains: [{ kind: "dotnet", minimum: v(8) }],
        capabilities: ["command_execution_available"],
        agentCapabilities: ["dotnet_development"],
        modelCapabilities: ["coding", "reasoning"],
        testTypes: ["unit", "integration", "build_verification"],
        sast: true,
        artifact: { kind: "dotnet_publish", name: "service-publish" },
    },
    {
        id: "dotnet_wpf",
        label: ".NET WPF desktop",
        componentKinds: ["desktop_app"],
        platforms: ["windows"],
        toolchains: [{ kind: "dotnet", minimum: v(8) }],
        os: { os: "windows" },
        capabilities: ["desktop_build_capable"],
        agentCapabilities: ["dotnet_development", "desktop_development"],
        modelCapabilities: ["coding", "reasoning"],
        testTypes: ["unit", "ui", "platform_specific", "build_verification"],
        sast: true,
        artifact: { kind: "windows_installer", name: "desktop-installer" },
    },
    {
        id: "swiftui",
        label: "SwiftUI (native Apple)",
        componentKinds: ["mobile_app", "desktop_app"],
        platforms: ["ios", "macos"],
        toolchains: [
            {
                kind: "swift_xcode",
                minimum: v(15),
                components: [{ name: "ios_sdk" }],
            },
        ],
        os: { os: "macos" },
        capabilities: ["mobile_build_capable"],
        agentCapabilities: ["ios_development"],
        modelCapabilities: ["coding", "reasoning"],
        testTypes: ["unit", "ui", "platform_specific", "build_verification"],
        sast: true,
        artifact: { kind: "ios_app_archive", name: "app-ipa" },
    },
    {
        id: "android_kotlin",
        label: "Android (Kotlin)",
        componentKinds: ["mobile_app"],
        platforms: ["android"],
        toolchains: [
            { kind: "jdk_gradle", minimum: v(17) },
            { kind: "android_sdk", components: [{ name: "build_tools" }] },
        ],
        toolchainDependencies: [{ from: "android_sdk", to: "jdk_gradle" }],
        capabilities: ["mobile_build_capable"],
        agentCapabilities: ["android_development"],
        modelCapabilities: ["coding", "reasoning"],
        testTypes: ["unit", "ui", "platform_specific", "build_verification"],
        sast: true,
        artifact: { kind: "android_app_bundle", name: "app-aab" },
    },
    {
        id: "unity",
        label: "Unity",
        componentKinds: ["game", "3d_application"],
        platforms: ["windows", "macos", "linux", "android", "ios", "web"],
        toolchains: [{ kind: "unity", minimum: v(2022, 3) }],
        platformComponents: {
            toolchain: "unity",
            byPlatform: {
                windows: "module:windows",
                macos: "module:macos",
                linux: "module:linux",
                android: "module:android",
                ios: "module:ios",
                web: "module:webgl",
            },
        },
        capabilities: ["game_build_capable"],
        agentCapabilities: ["game_development"],
        modelCapabilities: ["coding", "reasoning"],
        testTypes: ["unit", "platform_specific", "build_verification"],
        sast: false,
        artifact: { kind: "game_build", name: "unity-player" },
    },
    {
        id: "unreal",
        label: "Unreal Engine",
        componentKinds: ["game", "3d_application"],
        platforms: ["windows", "macos", "linux", "android", "ios"],
        toolchains: [
            { kind: "unreal", minimum: v(5, 3) },
            { kind: "cpp_compiler" },
        ],
        platformComponents: {
            toolchain: "unreal",
            byPlatform: {
                windows: "platform:windows",
                macos: "platform:macos",
                linux: "platform:linux",
                android: "platform:android",
                ios: "platform:ios",
            },
        },
        toolchainDependencies: [{ from: "unreal", to: "cpp_compiler" }],
        capabilities: ["game_build_capable"],
        agentCapabilities: ["game_development", "cpp_development"],
        modelCapabilities: ["coding", "reasoning"],
        testTypes: ["unit", "platform_specific", "build_verification"],
        sast: true,
        artifact: { kind: "game_build", name: "unreal-package" },
    },
    {
        id: "container_image",
        label: "Container image",
        componentKinds: ["backend_service"],
        platforms: ["linux"],
        toolchains: [],
        capabilities: ["container_runtime_available"],
        agentCapabilities: ["container_operations"],
        modelCapabilities: ["reasoning"],
        testTypes: ["build_verification", "integration"],
        sast: false,
        artifact: { kind: "container_image", name: "service-image" },
    },
];
/** Lookup over a validated set of profiles. Injectable for tests/extensions. */
export class TechnologyCatalog {
    version;
    byId = new Map();
    constructor(profiles = TECHNOLOGY_PROFILES, version = TECHNOLOGY_CATALOG_VERSION) {
        this.version = version;
        for (const profile of profiles) {
            if (this.byId.has(profile.id)) {
                throw new ValidationError(`duplicate technology profile: ${profile.id}`);
            }
            const kinds = new Set(profile.toolchains.map((t) => t.kind));
            for (const dep of profile.toolchainDependencies ?? []) {
                if (!kinds.has(dep.from) || !kinds.has(dep.to)) {
                    throw new ValidationError(`technology ${profile.id}: toolchain dependency references an undeclared toolchain`);
                }
            }
            this.byId.set(profile.id, profile);
        }
    }
    get(id) {
        return this.byId.get(id);
    }
    list() {
        return [...this.byId.values()].sort((a, b) => a.id.localeCompare(b.id));
    }
}
