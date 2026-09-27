import { CONTROL_PLANE_ANALYSIS_AGENT_ID, CONTROL_PLANE_ANALYSIS_TASK_TYPE, LazyOpenAIModelProvider, createProductionOpenAIAgentExecutor, } from "../agents/control-plane-analysis/index.js";
import { DeveloperAgent, makeDeveloperAgentDefinition } from "../agents/developer/index.js";
import { QaAgent, makeQaAgentDefinition } from "../agents/qa/index.js";
import { ProjectManagerAgent, makeProjectManagerAgentDefinition, } from "../agents/project-manager/index.js";
import { AI_WORKFORCE_DISPLAY_NAME, AI_WORKFORCE_REPOSITORY, AiWorkforceProjectAdapter, } from "../adapters/projects/ai-workforce/index.js";
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
 * EO-8 — the three specialist agents already fully implemented and tested
 * (`agents/developer`, `agents/qa`, `agents/project-manager`) but never
 * wired into any production composition root. Scoped to `money-mind` only —
 * the SAME project `CONTROL_PLANE_ANALYSIS_AGENT` uses and the only one
 * `GovernancePolicyStore.setTrusted` marks `allowUnknownCost: true` for
 * (none of these agents has a pre-call cost estimator either, same as
 * ADR-0029's rationale). Widening to `ai-workforce` would require either a
 * real cost estimate or trusting a second project on unknown cost — deferred
 * rather than done as an unreviewed side effect of this wiring. See ADR-0030.
 * `RESEARCH_AGENT` is deliberately NOT declared here: its only real tools
 * (`agents/research/research-agent-definition.ts`) have no production
 * implementation — `adapters/tools/static-research-tools.ts` is an explicitly
 * documented offline test double over a fixed corpus, and wiring it into
 * production would present canned results as real research.
 */
const SPECIALIST_AGENT_PROJECTS = ["money-mind"];
export const DEVELOPER_AGENT = Object.freeze(makeDeveloperAgentDefinition({
    allowedProjects: SPECIALIST_AGENT_PROJECTS,
    modelPolicy: { provider: "openai" },
}));
export const QA_AGENT = Object.freeze(makeQaAgentDefinition({
    allowedProjects: SPECIALIST_AGENT_PROJECTS,
    modelPolicy: { provider: "openai" },
}));
export const PROJECT_MANAGER_AGENT = Object.freeze(makeProjectManagerAgentDefinition({
    allowedProjects: SPECIALIST_AGENT_PROJECTS,
    modelPolicy: { provider: "openai" },
}));
/**
 * Bootstrap-time-only executor bindings for the three specialist agents.
 * `createProductionWorkforceBootstrap` calls these eagerly at construction,
 * before the Model Router / Cost Center exist in the composition root — the
 * SAME reason `openai-control-plane-analysis` below binds an audit-only
 * factory here. Every one of these three is immediately swapped for a
 * routed, metered instance via `RoutingAgentExecutor.replace` once the
 * Router exists (see `production-control-plane.ts`); nothing reaches this
 * unrouted, ungoverned binding for a real request.
 */
export const createBootstrapDeveloperAgentExecutor = (audit) => new DeveloperAgent({ model: new LazyOpenAIModelProvider(), audit });
export const createBootstrapQaAgentExecutor = (audit) => new QaAgent({ model: new LazyOpenAIModelProvider(), audit });
export const createBootstrapProjectManagerAgentExecutor = (audit) => new ProjectManagerAgent({ model: new LazyOpenAIModelProvider(), audit });
/**
 * The first internal production project: the AI Workforce platform itself,
 * represented by its own read-only adapter. Registration only makes the project
 * exist (so access can be granted and it appears in the graph); it starts
 * nothing. Repository identity is a credential-free reference.
 */
export function createAiWorkforceProductionBinding() {
    return Object.freeze({
        adapter: new AiWorkforceProjectAdapter(),
        displayName: AI_WORKFORCE_DISPLAY_NAME,
        metadata: Object.freeze({
            repository: Object.freeze({ ...AI_WORKFORCE_REPOSITORY }),
        }),
    });
}
/**
 * A further authoritative production project: Money Mind, on its real
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
        Object.freeze({ definition: DEVELOPER_AGENT, executorKey: "openai-developer" }),
        Object.freeze({ definition: QA_AGENT, executorKey: "openai-qa" }),
        Object.freeze({ definition: PROJECT_MANAGER_AGENT, executorKey: "openai-project-manager" }),
    ]),
    executorBindings: Object.freeze({
        "openai-control-plane-analysis": createProductionOpenAIAgentExecutor,
        "openai-developer": createBootstrapDeveloperAgentExecutor,
        "openai-qa": createBootstrapQaAgentExecutor,
        "openai-project-manager": createBootstrapProjectManagerAgentExecutor,
    }),
    tools: Object.freeze([]),
    toolHandlerBindings: Object.freeze({}),
    projectAdapters: Object.freeze([
        createAiWorkforceProductionBinding(),
        createMoneyMindProductionBinding(),
    ]),
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
