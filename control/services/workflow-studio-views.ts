/**
 * UI Layer 4 Workflow Studio read models. Everything here is derived from the
 * REAL registries (agents, tools, operational enable flags) — the palette never
 * lists a capability the platform does not have.
 */
import {
  UNAVAILABLE_WORKFLOW_NODE_KINDS,
  WORKFLOW_NODE_KINDS,
  type Agent,
  type WorkflowCapabilityContext,
  type WorkflowNodeKind,
  type UnavailableWorkflowNodeKind,
} from "../../contracts/index.js";

export interface CapabilitySources {
  agents: { list(): Agent[] };
  tools: { list(): { id: string; name?: string }[] };
  isAgentEnabled: (agentId: string, projectId: string) => boolean;
}

/** Agents usable on this project: allowed for it AND operationally enabled. */
export function workflowCapabilityContext(
  sources: CapabilitySources,
  projectId: string,
): WorkflowCapabilityContext {
  const agents = new Map<
    string,
    {
      capabilities: readonly string[];
      supportedTaskTypes: readonly string[];
      enabled: boolean;
    }
  >();
  for (const agent of sources.agents.list()) {
    agents.set(agent.id, {
      capabilities: agent.capabilities,
      supportedTaskTypes: agent.supportedTaskTypes,
      enabled:
        agent.allowedProjects.includes(projectId) &&
        sources.isAgentEnabled(agent.id, projectId),
    });
  }
  return { agents, tools: new Set(sources.tools.list().map((t) => t.id)) };
}

const NODE_BACKING: Record<WorkflowNodeKind, string> = {
  trigger: "Manual start by an authorized operator",
  agent_task: "Agent Registry + Workflow Engine task dispatch",
  approval: "Approval System (human decision)",
  terminal: "Workflow completion",
};

const UNAVAILABLE_REASON: Record<UnavailableWorkflowNodeKind, string> = {
  model:
    "Direct model calls are not exposed to workflows; models are reached only through agents and the Model Router.",
  tool: "Tools run only inside an agent task under the tool permission engine; there is no standalone tool step.",
  condition: "The Workflow Engine has no typed condition evaluator.",
  data: "There is no validated data-transformation capability.",
  review: "No review capability is registered as a workflow step.",
  notification: "No notification channel is configured.",
};

export interface WorkflowStudioCatalog {
  projectId: string;
  nodeKinds: { kind: WorkflowNodeKind; backing: string }[];
  unavailableNodeKinds: { kind: UnavailableWorkflowNodeKind; reason: string }[];
  agents: {
    agentId: string;
    name: string;
    capabilities: readonly string[];
    supportedTaskTypes: readonly string[];
    allowedTools: readonly string[];
    usableOnProject: boolean;
  }[];
  tools: { toolId: string; name: string }[];
  modes: {
    design: true;
    validation: true;
    simulation: true;
    dryRun: { available: false; reason: string };
    liveExecution: { available: false; reason: string };
  };
}

export function workflowStudioCatalog(
  sources: CapabilitySources,
  projectId: string,
): WorkflowStudioCatalog {
  const ctx = workflowCapabilityContext(sources, projectId);
  return {
    projectId,
    nodeKinds: WORKFLOW_NODE_KINDS.map((kind) => ({
      kind,
      backing: NODE_BACKING[kind],
    })),
    unavailableNodeKinds: UNAVAILABLE_WORKFLOW_NODE_KINDS.map((kind) => ({
      kind,
      reason: UNAVAILABLE_REASON[kind],
    })),
    agents: sources.agents
      .list()
      .map((a) => ({
        agentId: a.id,
        name: a.name,
        capabilities: a.capabilities,
        supportedTaskTypes: a.supportedTaskTypes,
        allowedTools: a.allowedTools,
        usableOnProject: ctx.agents.get(a.id)?.enabled ?? false,
      }))
      .sort((a, b) => a.agentId.localeCompare(b.agentId)),
    tools: sources.tools
      .list()
      .map((t) => ({ toolId: t.id, name: t.name ?? t.id }))
      .sort((a, b) => a.toolId.localeCompare(b.toolId)),
    modes: {
      design: true,
      validation: true,
      simulation: true,
      dryRun: {
        available: false,
        reason:
          "No execution path can guarantee zero external side effects, so no dry run is offered.",
      },
      liveExecution: {
        available: false,
        reason:
          "Workflow run state is held in memory by a runtime rebuilt per request in this deployment; a launched run would not be durable, so live launch is withheld until durable workflow run state exists.",
      },
    },
  };
}
