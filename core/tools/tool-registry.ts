import {
  type Tool,
  type ToolApprovalRule,
  type ToolDefinition,
  type ToolExecutionLimits,
  NotFoundError,
  ValidationError,
  validateToolDefinition,
} from "../../contracts/index.js";
import { AuditLog } from "../audit/audit-log.js";
import { agentAllowed, projectAllowed } from "./tool-policy.js";

/** Tool metadata without executable/schema functions — safe to expose. */
export interface ToolMetadataView {
  id: string;
  name: string;
  description: string;
  version: string;
  capabilities: readonly string[];
  requiredPermission: { action: string };
  approvalPolicy?: ToolApprovalRule;
  allowedAgents: readonly string[];
  allowedProjects: readonly string[];
  allowedEnvironments: readonly string[];
  timeoutMs: number;
  limits: ToolExecutionLimits;
  metadata: Record<string, unknown>;
}

/**
 * Registry of validated tools. A tool definition is frozen on registration and
 * can only change through {@link ToolRegistry.update} (which re-validates). The
 * registry never executes anything — it answers "does this tool exist / is this
 * agent or project eligible / what does it need".
 */
export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  constructor(private readonly audit?: AuditLog) {}

  register(tool: Tool): Tool {
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
  update(id: string, changes: Partial<Omit<ToolDefinition, "id">>): Tool {
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

  has(id: string): boolean {
    return this.tools.has(id);
  }

  get(id: string): Tool | undefined {
    return this.tools.get(id);
  }

  require(id: string): Tool {
    const tool = this.tools.get(id);
    if (!tool) throw new NotFoundError(`unknown tool: ${id}`);
    return tool;
  }

  list(): Tool[] {
    return [...this.tools.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  byCapability(capability: string): Tool[] {
    return this.list().filter((tool) => tool.capabilities.includes(capability));
  }

  eligibleForAgent(id: string, agentId: string): boolean {
    return agentAllowed(this.require(id), agentId);
  }

  eligibleForProject(id: string, projectId: string): boolean {
    return projectAllowed(this.require(id), projectId);
  }

  /** Public metadata for a tool — no handler, no schema functions. */
  describe(id: string): ToolMetadataView {
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

function freezeTool(tool: Tool): Tool {
  const frozen: Tool = {
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
