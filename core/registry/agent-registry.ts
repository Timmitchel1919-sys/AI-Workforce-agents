import {
  type Agent,
  type Repository,
  NotFoundError,
  ValidationError,
  validateAgent,
} from "../../contracts/index.js";
import { InMemoryRepository } from "../persistence/in-memory-repository.js";

/**
 * Store of declarative agent definitions.
 *
 * The registry validates every definition on registration, persists an
 * immutable copy through the injected {@link Repository} (in-memory by
 * default), and answers routing questions (by capability, by eligibility for a
 * task type on a project).
 */
export class AgentRegistry {
  constructor(
    private readonly repo: Repository<Agent> = new InMemoryRepository<Agent>(),
  ) {}

  register(agent: Agent): Agent {
    validateAgent(agent);
    if (this.repo.findById(agent.id)) {
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
    this.repo.upsert(stored);
    Object.freeze(stored);
    return stored;
  }

  has(id: string): boolean {
    return this.repo.findById(id) !== undefined;
  }

  get(id: string): Agent | undefined {
    return this.repo.findById(id);
  }

  require(id: string): Agent {
    const agent = this.repo.findById(id);
    if (!agent) throw new NotFoundError(`unknown agent: ${id}`);
    return agent;
  }

  /** Deterministic ordering by id. */
  list(): Agent[] {
    return this.repo.list().sort((a, b) => a.id.localeCompare(b.id));
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
