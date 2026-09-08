/**
 * Persistence contracts.
 *
 * The core domain depends only on these interfaces — never on a concrete
 * database or file format. A `Repository<T>` is a synchronous key/value store
 * of entities keyed by `id`; a `PersistenceProvider` bundles one repository per
 * durable Workforce collection.
 *
 * The synchronous shape keeps the core lifecycle code simple and deterministic.
 * A future networked store would introduce an async variant behind a new
 * interface revision (an ADR-gated change) — see ADR-0002.
 */
import type { Agent, Approval, AuditEvent, Handoff, Task } from "./index.js";

export interface Entity {
  id: string;
}

export interface Repository<T extends Entity> {
  /** Insert or replace an entity. Implementations store a defensive copy. */
  upsert(entity: T): void;
  findById(id: string): T | undefined;
  /** All entities, in insertion order. */
  list(): T[];
  /** Remove an entity. Returns `true` if it existed. */
  delete(id: string): boolean;
  /** Remove every entity. */
  clear(): void;
}

/**
 * The asynchronous sibling of {@link Repository}, for durable stores that can
 * only be reached over the network (Firestore, a SQL database, an HTTP API).
 *
 * The synchronous core lifecycle code never consumes this directly. A networked
 * store is bridged to `Repository<T>` by a hydrate-once, write-through cache
 * (`core/persistence/cached-repository.ts`) so the deterministic core is never
 * made async. Introduced by ADR-0011; the sync `Repository<T>` remains the
 * contract every core system is built on.
 */
export interface AsyncRepository<T extends Entity> {
  upsert(entity: T): Promise<void>;
  findById(id: string): Promise<T | undefined>;
  /** All entities. Order is implementation-defined. */
  list(): Promise<T[]>;
  /** Remove an entity. Resolves `true` if it existed. */
  delete(id: string): Promise<boolean>;
  /** Remove every entity. */
  clear(): Promise<void>;
}

export interface PersistenceProvider {
  readonly tasks: Repository<Task>;
  readonly agents: Repository<Agent>;
  readonly approvals: Repository<Approval>;
  readonly handoffs: Repository<Handoff>;
  readonly auditEvents: Repository<AuditEvent>;
}
