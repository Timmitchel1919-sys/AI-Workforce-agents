/** Public entry point for the internal event foundation. */

export { InMemoryEventBus, createEvent } from "./event-bus.js";
export type {
  DomainEvent,
  DomainEventName,
  DomainEventPayloads,
  EventHandler,
  AnyEventHandler,
  EventPublisher,
} from "./event-bus.js";
