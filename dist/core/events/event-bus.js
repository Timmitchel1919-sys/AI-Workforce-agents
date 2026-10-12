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
/** Build an envelope with a generated id and timestamp. */
export function createEvent(name, payload) {
    return { id: createId("evt"), name, occurredAt: now(), payload };
}
const log = createLogger("EventBus");
/**
 * In-memory event bus. Detached from any transport so tests and local wiring
 * are deterministic; production adapters can implement {@link EventPublisher}
 * on top of it.
 */
export class InMemoryEventBus {
    handlers = new Map();
    globalHandlers = new Set();
    recent = [];
    historyLimit;
    constructor(options = {}) {
        this.historyLimit = options.historyLimit ?? 100;
    }
    publish(event) {
        this.record(event);
        const named = this.handlers.get(event.name);
        if (named)
            for (const handler of named)
                this.safeInvoke(handler, event);
        for (const handler of this.globalHandlers)
            this.safeInvoke(handler, event);
    }
    /** Subscribe to a single event name. Returns an unsubscribe function. */
    subscribe(name, handler) {
        const set = this.handlers.get(name) ?? new Set();
        set.add(handler);
        this.handlers.set(name, set);
        return () => {
            set.delete(handler);
        };
    }
    /** Subscribe to every event. Returns an unsubscribe function. */
    subscribeAll(handler) {
        this.globalHandlers.add(handler);
        return () => {
            this.globalHandlers.delete(handler);
        };
    }
    /** Recent events, newest last. Bounded by `historyLimit`. */
    list() {
        return [...this.recent];
    }
    record(event) {
        this.recent.push(event);
        if (this.recent.length > this.historyLimit)
            this.recent.shift();
    }
    safeInvoke(handler, event) {
        try {
            handler(event);
        }
        catch (error) {
            log.error("event handler threw", {
                eventName: event.name,
                eventId: event.id,
                error,
            });
        }
    }
}
