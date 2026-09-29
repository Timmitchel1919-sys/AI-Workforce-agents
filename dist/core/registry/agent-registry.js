import { NotFoundError, StateTransitionError, ValidationError, canTransitionAdministrative, isSafeIdentifier, validateAgent, validateAgentDescriptor, validateAgentInstance, AGENT_INSTANCE_STATES, MAX_AGENT_DEFINITIONS, } from "../../contracts/index.js";
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
export class AgentRegistry {
    repo;
    clock;
    records = new Map();
    instances = new Map();
    constructor(repo = new InMemoryRepository(), clock = () => new Date().toISOString()) {
        this.repo = repo;
        this.clock = clock;
    }
    /* ---------------------------------------------------------------- */
    /* Registration                                                       */
    /* ---------------------------------------------------------------- */
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
    register(input) {
        if (!isAgentDescriptor(input))
            return this.registerAgent(input);
        if (this.records.size >= MAX_AGENT_DEFINITIONS && !this.records.has(input.id)) {
            throw new ValidationError(`agent registry is full (${MAX_AGENT_DEFINITIONS} agents)`);
        }
        validateAgentDescriptor(input);
        const existing = this.records.get(input.id);
        if (!existing) {
            const stored = this.freeze(input);
            const at = this.clock();
            this.records.set(input.id, {
                agent: stored,
                version: stored.version,
                registeredAt: at,
                updatedAt: at,
                revisions: Object.freeze([{ version: stored.version, registeredAt: at }]),
            });
            this.repo.upsert(stored);
            return stored;
        }
        if (sameDefinition(existing.agent, input))
            return existing.agent;
        if (input.version <= existing.version) {
            throw new ValidationError(`agent ${input.id} is already registered at version ${existing.version}; a changed definition must declare a strictly higher version`);
        }
        const stored = this.freeze(input);
        const at = this.clock();
        this.records.set(input.id, {
            agent: stored,
            version: stored.version,
            registeredAt: existing.registeredAt,
            updatedAt: at,
            revisions: Object.freeze([
                ...existing.revisions,
                { version: stored.version, registeredAt: at },
            ]),
        });
        this.repo.upsert(stored);
        return stored;
    }
    /**
     * Register a plain (non-descriptor) `Agent`. Used by the pre-existing
     * composition bindings, which are valid `Agent`s without the specialist
     * descriptor envelope. These are registered exactly as before: they are
     * describable and routable by the legacy path, and they carry NO specialist
     * qualification, tool ceiling, review or handoff policy — so they are never
     * eligible for specialist assignment.
     */
    registerAgent(agent) {
        validateAgent(agent);
        if (!isSafeIdentifier(agent.id)) {
            throw new ValidationError(`agent id is invalid: ${JSON.stringify(agent.id)}`);
        }
        if (this.records.has(agent.id))
            return this.records.get(agent.id).agent;
        if (this.repo.findById(agent.id)) {
            throw new ValidationError(`agent already registered: ${agent.id}`);
        }
        if (this.records.size >= MAX_AGENT_DEFINITIONS) {
            throw new ValidationError(`agent registry is full (${MAX_AGENT_DEFINITIONS} agents)`);
        }
        const stored = Object.freeze({
            ...agent,
            capabilities: Object.freeze([...agent.capabilities]),
            allowedTools: Object.freeze([...agent.allowedTools]),
            allowedProjects: Object.freeze([...agent.allowedProjects]),
            supportedTaskTypes: Object.freeze([...agent.supportedTaskTypes]),
            permissions: Object.freeze(agent.permissions.map((g) => Object.freeze({ ...g }))),
        });
        this.repo.upsert(stored);
        return stored;
    }
    freeze(descriptor) {
        return Object.freeze({
            ...descriptor,
            capabilities: Object.freeze([...descriptor.capabilities]),
            limitations: Object.freeze([...descriptor.limitations]),
            allowedTools: Object.freeze([...descriptor.allowedTools]),
            allowedProjects: Object.freeze([...descriptor.allowedProjects]),
            supportedTaskTypes: Object.freeze([...descriptor.supportedTaskTypes]),
            permissions: Object.freeze(descriptor.permissions.map((g) => Object.freeze({ ...g }))),
        });
    }
    /* ---------------------------------------------------------------- */
    /* Lookup                                                            */
    /* ---------------------------------------------------------------- */
    has(id) {
        return this.repo.findById(id) !== undefined;
    }
    /**
     * The registration record for a descriptor, or `undefined` for a legacy
     * `Agent` binding or an unknown id. Distinguishing "no descriptor" from
     * "not registered" matters: a legacy agent is not a failed lookup, it simply
     * never had a specialist definition.
     */
    record(id) {
        return this.records.get(id);
    }
    get(id) {
        return this.repo.findById(id);
    }
    require(id) {
        const agent = this.repo.findById(id);
        if (!agent)
            throw new NotFoundError(`unknown agent: ${id}`);
        return agent;
    }
    /** The full descriptor, or a NotFoundError. Never a partial object. */
    requireDescriptor(id) {
        const record = this.records.get(id);
        if (!record) {
            // Legacy `Agent` bindings are a real, known state — say so honestly
            // rather than pretending the agent does not exist.
            if (this.repo.findById(id)) {
                throw new NotFoundError(`agent ${id} is registered without a specialist descriptor`);
            }
            throw new NotFoundError(`unknown agent: ${id}`);
        }
        return record.agent;
    }
    hasDescriptor(id) {
        return this.records.has(id);
    }
    /** Deterministic ordering by id. */
    list() {
        return this.repo.list().sort((a, b) => a.id.localeCompare(b.id));
    }
    /** Every agent that has a full specialist descriptor, ordered by id. */
    listDescriptors() {
        return [...this.records.values()]
            .map((r) => r.agent)
            .sort((a, b) => a.id.localeCompare(b.id));
    }
    byCapability(capability) {
        return this.list().filter((agent) => agent.capabilities.includes(capability));
    }
    /** Agents allowed to work the given task type on the given project. */
    eligible(taskType, projectId) {
        return this.list().filter((agent) => agent.supportedTaskTypes.includes(taskType) &&
            agent.allowedProjects.includes(projectId));
    }
    /* ---------------------------------------------------------------- */
    /* Administrative lifecycle                                           */
    /* ---------------------------------------------------------------- */
    /**
     * The administrative state of an agent. Legacy `Agent` bindings have no
     * administrative lifecycle of their own — their enable/disable flag lives in
     * the control plane's `AgentOperationalStore` — so they report `undefined`
     * rather than a fabricated "active".
     */
    administrativeStatus(id) {
        return this.records.get(id)?.agent.administrativeStatus;
    }
    /**
     * Move an agent through the administrative lifecycle.
     *
     * This changes only the DESCRIPTOR'S administrative status. It never touches
     * an operational state, never releases a lease, and never cancels running
     * work: a suspended agent stops receiving NEW assignments and is allowed to
     * finish what it already holds. Destroying in-flight work would lose the
     * audit trail that makes reassignment auditable.
     */
    transitionAdministrative(id, to) {
        const record = this.records.get(id);
        if (!record)
            throw new NotFoundError(`unknown agent: ${id}`);
        const from = record.agent.administrativeStatus;
        if (from === to)
            return record.agent;
        if (!canTransitionAdministrative(from, to)) {
            throw new StateTransitionError(`illegal agent administrative transition: ${from} -> ${to}`);
        }
        const at = this.clock();
        const next = this.freeze({
            ...record.agent,
            administrativeStatus: to,
            version: record.version + 1,
            updatedAt: at,
        });
        this.records.set(id, {
            agent: next,
            version: next.version,
            registeredAt: record.registeredAt,
            updatedAt: at,
            revisions: Object.freeze([
                ...record.revisions,
                { version: next.version, registeredAt: at },
            ]),
        });
        this.repo.upsert(next);
        return next;
    }
    /* ---------------------------------------------------------------- */
    /* Filtering                                                         */
    /* ---------------------------------------------------------------- */
    /**
     * Server-side filter. Every criterion is optional and they combine with AND.
     * Filtering happens HERE, on the server, so a client can never widen the set
     * of agents it is shown by omitting a parameter.
     */
    filter(query) {
        return this.listDescriptors().filter((agent) => {
            if (query.projectId && !agent.projectPolicy.projects.includes(query.projectId)) {
                return false;
            }
            if (query.department && agent.department !== query.department)
                return false;
            if (query.role && agent.role !== query.role)
                return false;
            if (query.capability && !agent.capabilities.includes(query.capability)) {
                return false;
            }
            if (query.administrativeStatus &&
                agent.administrativeStatus !== query.administrativeStatus) {
                return false;
            }
            if (query.taskType && !agent.supportedTaskTypes.includes(query.taskType)) {
                return false;
            }
            return true;
        });
    }
    /** Distinct departments, ordered — for the Control Center's role filter. */
    departments() {
        return Object.freeze([
            ...new Set(this.listDescriptors().map((a) => a.department)),
        ].sort((a, b) => a.localeCompare(b)));
    }
    /* ---------------------------------------------------------------- */
    /* Instances (runtime) — never stored on the descriptor              */
    /* ---------------------------------------------------------------- */
    /**
     * Create an operational instance of a descriptor.
     *
     * The instance pins `descriptorId` + `descriptorVersion`, so a later
     * descriptor revision never rewrites the identity of work already recorded
     * against this instance.
     */
    createInstance(descriptorId, options = {}) {
        const record = this.records.get(descriptorId);
        if (!record)
            throw new NotFoundError(`unknown agent descriptor: ${descriptorId}`);
        if (record.agent.administrativeStatus !== "active") {
            throw new StateTransitionError(`agent ${descriptorId} is ${record.agent.administrativeStatus}; an instance may only be created for an active agent`);
        }
        if (options.projectId) {
            if (!isSafeIdentifier(options.projectId)) {
                throw new ValidationError("agent instance projectId is invalid");
            }
            if (!record.agent.projectPolicy.projects.includes(options.projectId)) {
                throw new ValidationError(`agent ${descriptorId} may not be instantiated for project ${options.projectId}`);
            }
        }
        const at = this.clock();
        const instance = {
            id: `${descriptorId}#1`,
            descriptorId,
            descriptorVersion: record.version,
            operationalState: "available",
            projectId: options.projectId,
            createdAt: at,
            updatedAt: at,
            ...(options.metadata ? { metadata: options.metadata } : {}),
        };
        validateAgentInstance(instance);
        this.instances.set(instance.id, Object.freeze(instance));
        return instance;
    }
    getInstance(id) {
        return this.instances.get(id);
    }
    listInstances() {
        return [...this.instances.values()].sort((a, b) => a.id.localeCompare(b.id));
    }
    /**
     * Update an instance's operational state.
     *
     * Operational state is DERIVED from authoritative records in practice; this
     * setter exists so a caller that has just recorded a real transition (an
     * assignment, a completion, a block) can keep the instance consistent with
     * it. It is not a way to assert a state that no record supports.
     */
    setInstanceState(id, state) {
        const instance = this.instances.get(id);
        if (!instance)
            throw new NotFoundError(`unknown agent instance: ${id}`);
        if (!AGENT_INSTANCE_STATES.includes(state)) {
            throw new ValidationError(`unknown operational state: ${state}`);
        }
        const next = Object.freeze({
            ...instance,
            operationalState: state,
            updatedAt: this.clock(),
        });
        this.instances.set(id, next);
        return next;
    }
}
/* ------------------------------------------------------------------ */
function sameDefinition(a, b) {
    return stableStringify(a) === stableStringify(b);
}
/** Key-sorted JSON so property order never decides whether two defs differ. */
function stableStringify(value) {
    if (value === null || typeof value !== "object")
        return JSON.stringify(value) ?? "null";
    if (Array.isArray(value))
        return `[${value.map(stableStringify).join(",")}]`;
    const entries = Object.entries(value)
        .filter(([key]) => key !== "createdAt" && key !== "updatedAt")
        .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}
class InMemoryRepository {
    items = new Map();
    list() {
        return [...this.items.values()];
    }
    findById(id) {
        return this.items.get(id);
    }
    upsert(item) {
        this.items.set(item.id, item);
    }
    delete(id) {
        return this.items.delete(id);
    }
    clear() {
        this.items.clear();
    }
}
/**
 * Structural test for "is this a full specialist descriptor?".
 *
 * Checks the one field no plain `Agent` can carry, rather than duck-typing a
 * dozen optional policies: `riskProfile` is required on a descriptor and
 * cannot be present on a base `Agent` without making the object a descriptor.
 */
function isAgentDescriptor(value) {
    return (typeof value.riskProfile === "string" &&
        typeof value.administrativeStatus === "string");
}
