import type { SecurityEventStore } from "../../core/security/security-event-store.js";
import type { DestructiveActionObserver } from "../../core/security/destructive-action-service.js";
import { type AsyncSecurityEventStore } from "../../contracts/security-event.js";
type AnyStore = SecurityEventStore | AsyncSecurityEventStore;
/**
 * Build an observer that writes safe, bounded canonical security
 * events whenever the destructive-action service emits a lifecycle
 * signal. The composition root is responsible for passing a durable
 * store; in-memory stores are fine for development.
 */
export declare function createDestructiveSecurityEventObserver(store: AnyStore): DestructiveActionObserver;
export {};
