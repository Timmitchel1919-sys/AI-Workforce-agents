import { type Agent, type Repository } from "../../contracts/index.js";
/**
 * Store of declarative agent definitions.
 *
 * The registry validates every definition on registration, persists an
 * immutable copy through the injected {@link Repository} (in-memory by
 * default), and answers routing questions (by capability, by eligibility for a
 * task type on a project).
 */
export declare class AgentRegistry {
    private readonly repo;
    constructor(repo?: Repository<Agent>);
    register(agent: Agent): Agent;
    has(id: string): boolean;
    get(id: string): Agent | undefined;
    require(id: string): Agent;
    /** Deterministic ordering by id. */
    list(): Agent[];
    byCapability(capability: string): Agent[];
    /** Agents allowed to work the given task type on the given project. */
    eligible(taskType: string, projectId: string): Agent[];
}
