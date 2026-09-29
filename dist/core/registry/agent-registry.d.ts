import { type Agent, type AgentAdministrativeStatus, type AgentDescriptor, type AgentInstance, type Repository } from "../../contracts/index.js";
/**
 * How an agent is read.
 *
 * `DESCRIPTOR` carries the full static definition — what the agent IS.
 * `OPERATIONAL` additionally carries an operational state derived from
 * authoritative assignment/execution records — what the agent is DOING.
 *
 * An agent with no operational records is `AVAILABLE` in the operational
 * sense ONLY; that says nothing about whether it is qualified for a given
 * task, and nothing about whether it may be assigned. Those are separate
 * questions answered elsewhere.
 */
export type AgentAdministrativeState = AgentAdministrativeStatus;
export interface AgentRegistrationRecord {
    readonly agent: AgentDescriptor;
    /** The descriptor version currently in force. */
    readonly version: number;
    readonly registeredAt: string;
    readonly updatedAt: string;
    /** Every version ever registered, oldest first. Historical identity is kept. */
    readonly revisions: readonly {
        version: number;
        registeredAt: string;
    }[];
}
/**
 * Store of declarative agent definitions — the server-authoritative registry.
 *
 * Two things this deliberately does NOT do:
 *
 *  1. It never mutates a registered definition in place. A change to an agent's
 *     capabilities or policies produces a NEW version, and past executions keep
 *     pointing at the version that produced them.
 *  2. It never grants authority. Registration makes an agent *describable*;
 *     whether it may be assigned work is decided by the qualification router
 *     and the governance engine, and whether it may act is decided by the
 *     permission system and the execution boundary.
 *
 * `AGENT != MODEL != PROVIDER != ENVIRONMENT != TOOL`: nothing in a descriptor
 * pins a model instance, an environment instance or a tool instance.
 */
export declare class AgentRegistry {
    private readonly repo;
    private readonly clock;
    private readonly records;
    private readonly instances;
    constructor(repo?: Repository<Agent>, clock?: () => string);
    /**
     * Register a new agent, or a NEW VERSION of an existing one.
     *
     * Accepts either a full specialist {@link AgentDescriptor} or a plain `Agent`
     * binding (the pre-existing composition shape). The two are stored in the
     * same place but not conflated: a plain `Agent` is registered through
     * {@link registerAgent} and carries NO specialist qualification, tool
     * ceiling, review or handoff policy, so it is never eligible for specialist
     * assignment and never appears in `listDescriptors()`.
     *
     * Re-registering an unchanged definition is a no-op (idempotent), which
     * keeps a composition root safe to build repeatedly. Re-registering a
     * CHANGED definition requires a strictly higher `version` — a silent
     * capability upgrade in place would rewrite the meaning of every historical
     * execution attributed to that agent.
     */
    register(input: Agent | AgentDescriptor): Agent;
    /**
     * Register a plain (non-descriptor) `Agent`. Used by the pre-existing
     * composition bindings, which are valid `Agent`s without the specialist
     * descriptor envelope. These are registered exactly as before: they are
     * describable and routable by the legacy path, and they carry NO specialist
     * qualification, tool ceiling, review or handoff policy — so they are never
     * eligible for specialist assignment.
     */
    registerAgent(agent: Agent): Agent;
    private freeze;
    has(id: string): boolean;
    /**
     * The registration record for a descriptor, or `undefined` for a legacy
     * `Agent` binding or an unknown id. Distinguishing "no descriptor" from
     * "not registered" matters: a legacy agent is not a failed lookup, it simply
     * never had a specialist definition.
     */
    record(id: string): AgentRegistrationRecord | undefined;
    get(id: string): Agent | undefined;
    require(id: string): Agent;
    /** The full descriptor, or a NotFoundError. Never a partial object. */
    requireDescriptor(id: string): AgentDescriptor;
    hasDescriptor(id: string): boolean;
    /** Deterministic ordering by id. */
    list(): Agent[];
    /** Every agent that has a full specialist descriptor, ordered by id. */
    listDescriptors(): readonly AgentDescriptor[];
    byCapability(capability: string): Agent[];
    /** Agents allowed to work the given task type on the given project. */
    eligible(taskType: string, projectId: string): Agent[];
    /**
     * The administrative state of an agent. Legacy `Agent` bindings have no
     * administrative lifecycle of their own — their enable/disable flag lives in
     * the control plane's `AgentOperationalStore` — so they report `undefined`
     * rather than a fabricated "active".
     */
    administrativeStatus(id: string): AgentAdministrativeStatus | undefined;
    /**
     * Move an agent through the administrative lifecycle.
     *
     * This changes only the DESCRIPTOR'S administrative status. It never touches
     * an operational state, never releases a lease, and never cancels running
     * work: a suspended agent stops receiving NEW assignments and is allowed to
     * finish what it already holds. Destroying in-flight work would lose the
     * audit trail that makes reassignment auditable.
     */
    transitionAdministrative(id: string, to: AgentAdministrativeStatus): AgentDescriptor;
    /**
     * Server-side filter. Every criterion is optional and they combine with AND.
     * Filtering happens HERE, on the server, so a client can never widen the set
     * of agents it is shown by omitting a parameter.
     */
    filter(query: {
        projectId?: string;
        department?: string;
        role?: string;
        capability?: string;
        administrativeStatus?: AgentAdministrativeStatus;
        taskType?: string;
    }): AgentDescriptor[];
    /** Distinct departments, ordered — for the Control Center's role filter. */
    departments(): readonly string[];
    /**
     * Create an operational instance of a descriptor.
     *
     * The instance pins `descriptorId` + `descriptorVersion`, so a later
     * descriptor revision never rewrites the identity of work already recorded
     * against this instance.
     */
    createInstance(descriptorId: string, options?: {
        projectId?: string;
        metadata?: Record<string, unknown>;
    }): AgentInstance;
    getInstance(id: string): AgentInstance | undefined;
    listInstances(): readonly AgentInstance[];
    /**
     * Update an instance's operational state.
     *
     * Operational state is DERIVED from authoritative records in practice; this
     * setter exists so a caller that has just recorded a real transition (an
     * assignment, a completion, a block) can keep the instance consistent with
     * it. It is not a way to assert a state that no record supports.
     */
    setInstanceState(id: string, state: AgentInstance["operationalState"]): AgentInstance;
}
