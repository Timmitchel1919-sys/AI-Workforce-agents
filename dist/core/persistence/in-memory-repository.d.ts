import type { Agent, Approval, AuditEvent, Entity, Handoff, PersistenceProvider, Repository, Task } from "../../contracts/index.js";
/**
 * Default `Repository` implementation. Holds entities in a `Map` for the life
 * of the process. Stores a structured-clone copy on write and returns a copy
 * on read so callers cannot mutate stored state by reference.
 *
 * This is the zero-configuration backend used by every core system when no
 * durable provider is injected. It is pure (no `fs`, no `node:` I/O) and lives
 * in `core/` deliberately.
 */
export declare class InMemoryRepository<T extends Entity> implements Repository<T> {
    private readonly entities;
    constructor(seed?: readonly T[]);
    upsert(entity: T): void;
    findById(id: string): T | undefined;
    list(): T[];
    delete(id: string): boolean;
    clear(): void;
    private copy;
}
/** All-in-memory `PersistenceProvider`. Nothing survives process exit. */
export declare class InMemoryPersistence implements PersistenceProvider {
    readonly tasks: InMemoryRepository<Task>;
    readonly agents: InMemoryRepository<Agent>;
    readonly approvals: InMemoryRepository<Approval>;
    readonly handoffs: InMemoryRepository<Handoff>;
    readonly auditEvents: InMemoryRepository<AuditEvent>;
}
