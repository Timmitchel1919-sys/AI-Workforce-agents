/**
 * Lightweight internal event foundation.
 *
 * Defines the canonical event names and a typed envelope, plus a minimal
 * publisher/subscriber interface and an in-memory bus. This is deliberately
 * not the full orchestration event system — it is the stable contract that the
 * Workflow, Agent and Observability layers will extend.
 */
export interface DomainEventPayloads {
    USER_AUTHENTICATED: {
        userId: string;
    };
    USER_LOGGED_OUT: {
        userId: string;
    };
    PROJECT_CREATED: {
        projectId: string;
    };
    PROJECT_UPDATED: {
        projectId: string;
    };
    PROJECT_ARCHIVED: {
        projectId: string;
    };
    TASK_CREATED: {
        taskId: string;
        projectId?: string;
    };
    WORKFLOW_STARTED: {
        workflowId: string;
        projectId?: string;
    };
    AGENT_STARTED: {
        agentId: string;
        taskId?: string;
    };
    AGENT_COMPLETED: {
        agentId: string;
        taskId?: string;
        result?: string;
    };
    TOOL_EXECUTED: {
        toolId: string;
        agentId?: string;
        taskId?: string;
    };
    APPROVAL_REQUESTED: {
        approvalId: string;
        action?: string;
    };
    DEPLOYMENT_STARTED: {
        deploymentId: string;
        projectId?: string;
    };
    DEPLOYMENT_COMPLETED: {
        deploymentId: string;
        projectId?: string;
    };
    SECURITY_EVENT: {
        kind: string;
        detail?: string;
    };
}
export type DomainEventName = keyof DomainEventPayloads;
/** Immutable event envelope handed to subscribers. */
export interface DomainEvent<N extends DomainEventName = DomainEventName> {
    id: string;
    name: N;
    occurredAt: string;
    payload: DomainEventPayloads[N];
}
export type EventHandler<N extends DomainEventName> = (event: DomainEvent<N>) => void;
export type AnyEventHandler = (event: DomainEvent) => void;
/** Contract future publishers depend on. */
export interface EventPublisher {
    publish<N extends DomainEventName>(event: DomainEvent<N>): void;
}
/** Build an envelope with a generated id and timestamp. */
export declare function createEvent<N extends DomainEventName>(name: N, payload: DomainEventPayloads[N]): DomainEvent<N>;
/**
 * In-memory event bus. Detached from any transport so tests and local wiring
 * are deterministic; production adapters can implement {@link EventPublisher}
 * on top of it.
 */
export declare class InMemoryEventBus implements EventPublisher {
    private readonly handlers;
    private readonly globalHandlers;
    private readonly recent;
    private readonly historyLimit;
    constructor(options?: {
        historyLimit?: number;
    });
    publish<N extends DomainEventName>(event: DomainEvent<N>): void;
    /** Subscribe to a single event name. Returns an unsubscribe function. */
    subscribe<N extends DomainEventName>(name: N, handler: EventHandler<N>): () => void;
    /** Subscribe to every event. Returns an unsubscribe function. */
    subscribeAll(handler: AnyEventHandler): () => void;
    /** Recent events, newest last. Bounded by `historyLimit`. */
    list(): readonly DomainEvent[];
    private record;
    private safeInvoke;
}
