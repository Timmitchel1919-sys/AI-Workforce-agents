import type { Agent, Approval, AuditEvent, Entity, Handoff, PersistenceProvider, Repository, Task } from "../../contracts/index.js";
export declare class InMemoryRepository<T extends Entity> implements Repository<T> {
    private readonly entities;
    private readonly tenantContext;
    constructor(seed?: readonly T[]);
    private isAllowed;
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
