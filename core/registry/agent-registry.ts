import {
  type Agent,
  NotFoundError,
  ValidationError,
  validateAgent,
} from "../../contracts/index.js";

/**
 * In-memory store of declarative agent definitions.
 *
 * The registry validates every definition on registration, stores an immutable
 * copy, and answers routing questions (by capability, by eligibility for a
 * task type on a project).
 */
export class AgentRegistry {
  private readonly agents = new Map<string, Agent>();

  register(agent: Agent): Agent {
    validateAgent(agent);
    if (this.agents.has(agent.id)) {
      throw new ValidationError(`agent already registered: ${agent.id}`);
    }

    const stored: Agent = {
      ...agent,
      capabilities: [...agent.capabilities],
      allowedTools: [...agent.allowedTools],
      allowedProjects: [...agent.allowedProjects],
      supportedTaskTypes: [...agent.supportedTaskTypes],
      permissions: agent.permissions.map((grant) => ({ ...grant })),
      modelPolicy: agent.modelPolicy ? { ...agent.modelPolicy } : undefined,
      metadata: agent.metadata ? { ...agent.metadata } : undefined,
    };
    Object.freeze(stored);
    this.agents.set(stored.id, stored);
    return stored;
  }

  has(id: string): boolean {
    return this.agents.has(id);
  }

  get(id: string): Agent | undefined {
    return this.agents.get(id);
  }

  require(id: string): Agent {
    const agent = this.agents.get(id);
    if (!agent) throw new NotFoundError(`unknown agent: ${id}`);
    return agent;
  }

  /** Deterministic ordering by id. */
  list(): Agent[] {
    return [...this.agents.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  byCapability(capability: string): Agent[] {
    return this.list().filter((agent) =>
      agent.capabilities.includes(capability),
    );
  }

  /** Agents allowed to work the given task type on the given project. */
  eligible(taskType: string, projectId: string): Agent[] {
    return this.list().filter(
      (agent) =>
        agent.supportedTaskTypes.includes(taskType) &&
        agent.allowedProjects.includes(projectId),
    );
  }
}
