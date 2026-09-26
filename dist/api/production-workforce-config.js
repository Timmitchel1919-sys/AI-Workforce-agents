import { CONTROL_PLANE_ANALYSIS_AGENT_ID, CONTROL_PLANE_ANALYSIS_TASK_TYPE, createProductionOpenAIAgentExecutor, } from "../agents/control-plane-analysis/index.js";
import { MoneyMindProjectAdapter, NodeMoneyMindRepo, UnavailableMoneyMindRepo, loadMoneyMindConfig, } from "../adapters/projects/money-mind/index.js";
const DENIED_ACTIONS = [
    "write",
    "deploy",
    "external_communication",
    "secret_access",
];
export const CONTROL_PLANE_ANALYSIS_AGENT = Object.freeze({
    id: CONTROL_PLANE_ANALYSIS_AGENT_ID,
    name: "Control Plane Analysis Agent",
    description: "Produces bounded, read-only structured analysis of an explicitly supplied Workforce task context.",
    capabilities: ["control_plane_analysis", "software_analysis"],
    allowedTools: [],
    allowedProjects: ["money-mind"],
    supportedTaskTypes: [CONTROL_PLANE_ANALYSIS_TASK_TYPE],
    permissions: DENIED_ACTIONS.map((action) => ({
        effect: "deny",
        action,
        agentId: CONTROL_PLANE_ANALYSIS_AGENT_ID,
        reason: `read-only analysis agent: ${action} is denied`,
    })),
    modelPolicy: { provider: "openai" },
    metadata: Object.freeze({
        role: "control_plane_analyst",
        readOnly: true,
        toolAccess: "none",
    }),
});
/**
 * The first authoritative production project: Money Mind, on its real
 * adapter. A Cloud Function has no Money Mind checkout, so unless
 * `MONEY_MIND_REPO_PATH` is configured the repository backend is the explicit
 * {@link UnavailableMoneyMindRepo}: the project is registered (access can be
 * granted, it appears in the graph) while every repository read or run fails
 * honestly with "repository is not available". No fixture or synthetic data
 * is ever substituted and no filesystem path is probed.
 */
export function createMoneyMindProductionBinding(env = process.env) {
    const configured = loadMoneyMindConfig({}, env);
    return Object.freeze({
        adapter: new MoneyMindProjectAdapter({
            repo: configured
                ? new NodeMoneyMindRepo({ repoPath: configured.repoPath })
                : new UnavailableMoneyMindRepo(),
        }),
        displayName: "Money Mind",
        metadata: Object.freeze({ sourceAvailable: configured !== undefined }),
    });
}
export const PRODUCTION_WORKFORCE_CONFIGURATION = Object.freeze({
    agents: Object.freeze([
        Object.freeze({
            definition: CONTROL_PLANE_ANALYSIS_AGENT,
            executorKey: "openai-control-plane-analysis",
        }),
    ]),
    executorBindings: Object.freeze({
        "openai-control-plane-analysis": createProductionOpenAIAgentExecutor,
    }),
    tools: Object.freeze([]),
    toolHandlerBindings: Object.freeze({}),
    projectAdapters: Object.freeze([createMoneyMindProductionBinding()]),
    permissionGrants: Object.freeze([]),
});
/**
 * The trusted, non-secret environment *support* catalog — descriptors only.
 * These answer "what can the workforce support?", never "what is installed".
 * No real host is seeded; registered hosts/environments come exclusively from
 * live discovery (EO-2B+ probes). See EO-2A.
 */
export const PRODUCTION_ENVIRONMENT_DESCRIPTORS = Object.freeze([
    Object.freeze({
        id: "web-build-cli",
        name: "Web Build (Node CLI)",
        description: "CLI-based web application build environment requiring Node and npm.",
        environmentType: "web_build",
        supportedToolchains: Object.freeze([Object.freeze({ kind: "node" })]),
        requiredCapabilities: Object.freeze([]),
        declaredCapabilities: Object.freeze([
            "command_execution_available",
            "web_build_capable",
        ]),
    }),
    Object.freeze({
        id: "desktop-build",
        name: "Desktop Build",
        description: "Desktop application build using the .NET SDK.",
        environmentType: "desktop_build",
        supportedToolchains: Object.freeze([Object.freeze({ kind: "dotnet" })]),
        requiredCapabilities: Object.freeze([]),
        declaredCapabilities: Object.freeze([
            "command_execution_available",
            "desktop_build_capable",
        ]),
    }),
    Object.freeze({
        id: "xcode-build-host",
        name: "macOS Xcode Build Host",
        description: "Apple/macOS build environment via Xcode and Swift.",
        environmentType: "xcode",
        supportedToolchains: Object.freeze([
            Object.freeze({ kind: "swift_xcode" }),
        ]),
        requiredCapabilities: Object.freeze([]),
        declaredCapabilities: Object.freeze([
            "command_execution_available",
            "mobile_build_capable",
            "desktop_build_capable",
        ]),
        minimumOs: Object.freeze({ os: "macos" }),
    }),
    Object.freeze({
        id: "docker-runtime-host",
        name: "Container Runtime Host",
        description: "Host with a usable Docker/container runtime.",
        environmentType: "docker",
        supportedToolchains: Object.freeze([]),
        requiredCapabilities: Object.freeze([]),
        declaredCapabilities: Object.freeze([
            "command_execution_available",
            "container_runtime_available",
        ]),
    }),
    Object.freeze({
        id: "generic-cli-host",
        name: "Generic CLI Host",
        description: "Plain command-line execution host with no build tooling.",
        environmentType: "cli",
        supportedToolchains: Object.freeze([]),
        requiredCapabilities: Object.freeze([]),
        declaredCapabilities: Object.freeze([
            "command_execution_available",
        ]),
    }),
]);
