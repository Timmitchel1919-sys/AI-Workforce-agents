import {
  WorkforceGraphProjection,
  WorkforceGraphNode,
  WorkforceGraphEdge,
  GraphQueryOptions,
} from "../../contracts/graph.js";
import { AgentRegistry, ProjectRegistry, TaskSystem } from "../index.js";
import { SoftwareFactoryOrchestrator } from "./software-factory-orchestrator.js";

export class WorkforceGraphProjectionService {
  private revision = 1;

  constructor(
    private readonly projectRegistry: ProjectRegistry,
    private readonly agentRegistry: AgentRegistry,
    private readonly taskSystem: TaskSystem,
    private readonly sfOrchestrator: SoftwareFactoryOrchestrator,
  ) {}

  public getProjection(options: GraphQueryOptions): WorkforceGraphProjection {
    const nodes: Map<string, WorkforceGraphNode> = new Map();
    const edges: Map<string, WorkforceGraphEdge> = new Map();

    const addNode = (node: WorkforceGraphNode) => {
      if (!nodes.has(node.id)) {
        nodes.set(node.id, node);
      }
    };

    const addEdge = (edge: WorkforceGraphEdge) => {
      if (!edges.has(edge.id)) {
        edges.set(edge.id, edge);
      }
    };

    const project = this.projectRegistry.get(options.projectId);
    if (!project) {
      throw new Error("Project not found");
    }

    addNode({
      id: `project-${project.projectId}`,
      type: "PROJECT",
      label: project.displayName || project.projectId,
      status: "active",
      projectId: project.projectId,
      referenceId: project.projectId,
    });

    const agents = this.agentRegistry.list();
    for (const agent of agents) {
      addNode({
        id: `agent-${agent.id}`,
        type: "AGENT",
        label: agent.name || agent.id,
        status: "active",
        projectId: options.projectId,
        referenceId: agent.id,
        metadata: { role: agent.description },
      });
      addEdge({
        id: `project-has-agent-${agent.id}`,
        source: `project-${project.projectId}`,
        target: `agent-${agent.id}`,
        type: "CONTAINS",
      });
    }

    const tasks = this.taskSystem.list().filter(t => t.projectId === options.projectId).slice(0, options.maxNodes || 100);
    for (const task of tasks) {
      addNode({
        id: `task-${task.id}`,
        type: "TASK",
        label: task.description,
        status: task.status,
        projectId: options.projectId,
        referenceId: task.id,
      });

      addEdge({
        id: `project-has-task-${task.id}`,
        source: `project-${project.projectId}`,
        target: `task-${task.id}`,
        type: "HAS_TASK",
      });

      if (task.assignedAgentId) {
        addEdge({
          id: `agent-assigned-${task.id}`,
          source: `agent-${task.assignedAgentId}`,
          target: `task-${task.id}`,
          type: "ASSIGNED_TO",
        });
      }

      const dependsOn = (task as any).dependencies || [];
      for (const depId of dependsOn) {
        addEdge({
          id: `task-dep-${task.id}-${depId}`,
          source: `task-${task.id}`,
          target: `task-${depId}`,
          type: "DEPENDS_ON",
        });
      }
    }

    const sfOverview = this.sfOrchestrator.overview();
    for (const program of sfOverview.programs) {
      if (program.projectId === options.projectId) {
        addNode({
          id: `program-${program.id}`,
          type: "PROGRAM",
          label: program.name || program.id,
          status: program.status,
          projectId: options.projectId,
          referenceId: program.id,
        });
        addEdge({
          id: `project-has-program-${program.id}`,
          source: `project-${project.projectId}`,
          target: `program-${program.id}`,
          type: "CONTAINS",
        });
      }
    }

    return {
      projectId: options.projectId,
      revision: this.revision++,
      generatedAt: new Date().toISOString(),
      nodes: Array.from(nodes.values()),
      edges: Array.from(edges.values()),
    };
  }
}
