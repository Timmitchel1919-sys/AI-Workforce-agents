import { type Agent, validateAgent } from "../../contracts/index.js";

export class AgentRegistry {
  private readonly agents = new Map<string, Agent>();
  register(agent: Agent): Agent {
    validateAgent(agent);
    if (this.agents.has(agent.id)) throw new Error(`agent already registered: ${agent.id}`);
    this.agents.set(agent.id, Object.freeze({ ...agent }));
    return agent;
  }
  get(id: string): Agent | undefined { return this.agents.get(id); }
  byCapability(capability: string): Agent[] { return this.list().filter((agent) => agent.capabilities.includes(capability)); }
  eligible(taskType: string, projectId: string): Agent[] {
    return this.list().filter((agent) => agent.supportedTaskTypes.includes(taskType) && agent.allowedProjects.includes(projectId));
  }
  list(): Agent[] { return [...this.agents.values()].sort((a, b) => a.id.localeCompare(b.id)); }
}
