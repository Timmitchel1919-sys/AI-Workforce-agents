/**
 * Lightweight internal event foundation.
 *
 * Defines the canonical event names and a typed envelope, plus a minimal
 * publisher/subscriber interface and an in-memory bus. This is deliberately
 * not the full orchestration event system — it is the stable contract that the
 * Workflow, Agent and Observability layers will extend.
 */

import { createId, now } from "../shared.js";
import { createLogger } from "../logging/index.js";

export interface DomainEventPayloads {
  USER_AUTHENTICATED: { userId: string };
  USER_LOGGED_OUT: { userId: string };
  PROJECT_CREATED: { projectId: string };
  PROJECT_UPDATED: { projectId: string };
  PROJECT_ARCHIVED: { projectId: string };
  TASK_CREATED: { taskId: string; projectId?: string };
  WORKFLOW_STARTED: { workflowId: string; projectId?: string };
  AGENT_STARTED: { agentId: string; taskId?: string };
  AGENT_COMPLETED: { agentId: string; taskId?: string; result?: string };
  TOOL_EXECUTED: { toolId: string; agentId?: string; taskId?: string };
  APPROVAL_REQUESTED: { approvalId: string; action?: string };
  DEPLOYMENT_STARTED: { deploymentId: string; projectId?: string };
  DEPLOYMENT_COMPLETED: { deploymentId: string; projectId?: string };
  SECURITY_EVENT: { kind: string; detail?: string };
}

export type DomainEventName = keyof DomainEventPayloads;

/** Immutable event envelope handed to subscribers. */
export interface DomainEvent<N extends DomainEventName = DomainEventName> {
  id: string;
  name: N;
  occurredAt: string;
  payload: DomainEventPayloads[N];
}

export type EventHandler<N extends DomainEventName> = (
  event: DomainEvent<N>,
) => void;

export type AnyEventHandler = (event: DomainEvent) => void;

/** Contract future publishers depend on. */
export interface EventPublisher {
  publish<N extends DomainEventName>(event: DomainEvent<N>): void;
}

/** Build an envelope with a generated id and timestamp. */
export function createEvent<N extends DomainEventName>(
  name: N,
  payload: DomainEventPayloads[N],
): DomainEvent<N> {
  return { id: createId("evt"), name, occurredAt: now(), payload };
}

const log = createLogger("EventBus");

/**
 * In-memory event bus. Detached from any transport so tests and local wiring
 * are deterministic; production adapters can implement {@link EventPublisher}
 * on top of it.
 */
export class InMemoryEventBus implements EventPublisher {
  private readonly handlers = new Map<DomainEventName, Set<AnyEventHandler>>();
  private readonly globalHandlers = new Set<AnyEventHandler>();
  private readonly recent: DomainEvent[] = [];
  private readonly historyLimit: number;

  constructor(options: { historyLimit?: number } = {}) {
    this.historyLimit = options.historyLimit ?? 100;
  }

  publish<N extends DomainEventName>(event: DomainEvent<N>): void {
    this.record(event);
    const named = this.handlers.get(event.name);
    if (named) for (const handler of named) this.safeInvoke(handler, event);
    for (const handler of this.globalHandlers) this.safeInvoke(handler, event);
  }

  /** Subscribe to a single event name. Returns an unsubscribe function. */
  subscribe<N extends DomainEventName>(
    name: N,
    handler: EventHandler<N>,
  ): () => void {
    const set = this.handlers.get(name) ?? new Set<AnyEventHandler>();
    set.add(handler as AnyEventHandler);
    this.handlers.set(name, set);
    return () => {
      set.delete(handler as AnyEventHandler);
    };
  }

  /** Subscribe to every event. Returns an unsubscribe function. */
  subscribeAll(handler: AnyEventHandler): () => void {
    this.globalHandlers.add(handler);
    return () => {
      this.globalHandlers.delete(handler);
    };
  }

  /** Recent events, newest last. Bounded by `historyLimit`. */
  list(): readonly DomainEvent[] {
    return [...this.recent];
  }

  private record(event: DomainEvent): void {
    this.recent.push(event);
    if (this.recent.length > this.historyLimit) this.recent.shift();
  }

  private safeInvoke(handler: AnyEventHandler, event: DomainEvent): void {
    try {
      handler(event);
    } catch (error) {
      log.error("event handler threw", {
        eventName: event.name,
        eventId: event.id,
        error,
      });
    }
  }
}
