/**
 * Declarative definition and permission grants for the Project Manager Agent.
 * No behaviour here — see `project-manager-agent.ts`.
 */
import { DEFAULT_AGENT_LIMITS, } from "../../contracts/index.js";
export const PROJECT_MANAGER_AGENT_ID = "project-manager-agent";
export const PROJECT_MANAGER_PLAN_TASK_TYPE = "project-manager-plan";
export const PROJECT_MANAGER_AGENT_LIMITS = {
    ...DEFAULT_AGENT_LIMITS,
    maxIterations: 2,
    maxToolCalls: 0,
    maxModelCalls: 1,
    timeoutMs: 60_000,
};
const RISKY_ACTIONS = [
    "write",
    "deploy",
    "external_communication",
    "secret_access",
];
/**
 * The Project Manager has no tools and needs no `allow` grants — it produces a
 * decomposition/summary decision only. Deny grants are explicit anyway, as
 * defence in depth if a future revision ever adds a capability.
 */
export function projectManagerGrants(agentId = PROJECT_MANAGER_AGENT_ID, extra = []) {
    return [
        ...extra,
        ...RISKY_ACTIONS.map((action) => ({
            effect: "deny",
            action,
            agentId,
            reason: `project manager does not act directly (${action} denied)`,
        })),
    ];
}
export function makeProjectManagerAgentDefinition(options) {
    return {
        id: PROJECT_MANAGER_AGENT_ID,
        name: "Project Manager Agent",
        description: "Decomposes a high-level objective into a structured, dependency-ordered " +
            "subtask plan, and summarizes a completed workflow. Never executes a tool " +
            "or dispatches a task itself — the WorkflowEngine validates and executes " +
            "every recommendation.",
        capabilities: [
            "task_decomposition",
            "workflow_planning",
            "workflow_summary",
        ],
        allowedTools: [...(options.extraAllowedTools ?? [])],
        allowedProjects: [...options.allowedProjects],
        supportedTaskTypes: [PROJECT_MANAGER_PLAN_TASK_TYPE],
        permissions: projectManagerGrants(PROJECT_MANAGER_AGENT_ID, options.extraGrants ?? []),
        modelPolicy: options.modelPolicy,
        metadata: {
            role: "project-manager",
            successCriteria: [
                "output validates against the ProjectManagerDecision contract",
                "every recommended subtask/agent is re-validated by the WorkflowEngine before any task is created",
            ],
            errorBehavior: "fail closed with a structured AgentExecutionError; never create a " +
                "task or assign an agent itself",
            limits: PROJECT_MANAGER_AGENT_LIMITS,
        },
    };
}
