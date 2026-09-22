import { NotFoundError, ValidationError, validateToolDefinition, } from "../../contracts/index.js";
import { agentAllowed, projectAllowed } from "./tool-policy.js";
/**
 * Registry of validated tools. A tool definition is frozen on registration and
 * can only change through {@link ToolRegistry.update} (which re-validates). The
 * registry never executes anything — it answers "does this tool exist / is this
 * agent or project eligible / what does it need".
 */
export class ToolRegistry {
    audit;
    tools = new Map();
    constructor(audit) {
        this.audit = audit;
    }
    register(tool) {
        validateToolDefinition(tool);
        if (typeof tool.execute !== "function") {
            throw new ValidationError(`tool "${tool.id}" has no execute handler`);
        }
        if (this.tools.has(tool.id)) {
            throw new ValidationError(`tool already registered: ${tool.id}`);
        }
        const stored = freezeTool(tool);
        this.tools.set(stored.id, stored);
        this.audit?.record("tool_registered", {
            data: {
                toolId: stored.id,
                version: stored.version,
                capabilities: [...stored.capabilities],
                action: "register",
            },
        });
        return stored;
    }
    /** The only sanctioned way to change a registered definition. Re-validates. */
    update(id, changes) {
        const current = this.require(id);
        const next = freezeTool({
            ...current,
            ...changes,
            id: current.id,
            execute: current.execute,
        });
        validateToolDefinition(next);
        this.tools.set(id, next);
        this.audit?.record("tool_registered", {
            data: { toolId: id, version: next.version, action: "update" },
        });
        return next;
    }
    has(id) {
        return this.tools.has(id);
    }
    get(id) {
        return this.tools.get(id);
    }
    require(id) {
        const tool = this.tools.get(id);
        if (!tool)
            throw new NotFoundError(`unknown tool: ${id}`);
        return tool;
    }
    list() {
        return [...this.tools.values()].sort((a, b) => a.id.localeCompare(b.id));
    }
    byCapability(capability) {
        return this.list().filter((tool) => tool.capabilities.includes(capability));
    }
    eligibleForAgent(id, agentId) {
        return agentAllowed(this.require(id), agentId);
    }
    eligibleForProject(id, projectId) {
        return projectAllowed(this.require(id), projectId);
    }
    /** Public metadata for a tool — no handler, no schema functions. */
    describe(id) {
        const tool = this.require(id);
        return {
            id: tool.id,
            name: tool.name,
            description: tool.description,
            version: tool.version,
            capabilities: [...tool.capabilities],
            requiredPermission: { action: tool.requiredPermission.action },
            approvalPolicy: tool.approvalPolicy
                ? { ...tool.approvalPolicy }
                : undefined,
            allowedAgents: [...tool.allowedAgents],
            allowedProjects: [...tool.allowedProjects],
            allowedEnvironments: [...tool.allowedEnvironments],
            timeoutMs: tool.timeoutMs,
            limits: { ...tool.limits },
            metadata: { ...tool.metadata },
        };
    }
}
function freezeTool(tool) {
    const frozen = {
        ...tool,
        capabilities: Object.freeze([...tool.capabilities]),
        allowedAgents: Object.freeze([...tool.allowedAgents]),
        allowedProjects: Object.freeze([...tool.allowedProjects]),
        allowedEnvironments: Object.freeze([...tool.allowedEnvironments]),
        requiredPermission: Object.freeze({ ...tool.requiredPermission }),
        limits: Object.freeze({ ...tool.limits }),
        approvalPolicy: tool.approvalPolicy
            ? Object.freeze({ ...tool.approvalPolicy })
            : undefined,
        metadata: Object.freeze({ ...tool.metadata }),
    };
    return Object.freeze(frozen);
}
