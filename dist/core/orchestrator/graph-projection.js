export class WorkforceGraphProjectionService {
    projectRegistry;
    agentRegistry;
    taskSystem;
    sfOrchestrator;
    revision = 1;
    constructor(projectRegistry, agentRegistry, taskSystem, sfOrchestrator) {
        this.projectRegistry = projectRegistry;
        this.agentRegistry = agentRegistry;
        this.taskSystem = taskSystem;
        this.sfOrchestrator = sfOrchestrator;
    }
    getProjection(options) {
        const nodes = new Map();
        const edges = new Map();
        const addNode = (node) => {
            if (!nodes.has(node.id)) {
                nodes.set(node.id, node);
            }
        };
        const addEdge = (edge) => {
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
        const agents = this.agentRegistry.list().filter(a => a.allowedProjects.includes(options.projectId) || a.allowedProjects.includes("*"));
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
            const dependsOn = task.dependencies || [];
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
