/**
 * Default `Repository` implementation. Holds entities in a `Map` for the life
 * of the process. Stores a structured-clone copy on write and returns a copy
 * on read so callers cannot mutate stored state by reference.
 *
 * This is the zero-configuration backend used by every core system when no
 * durable provider is injected. It is pure (no `fs`, no `node:` I/O) and lives
 * in `core/` deliberately.
 */
export class InMemoryRepository {
    entities = new Map();
    constructor(seed = []) {
        for (const entity of seed)
            this.upsert(entity);
    }
    upsert(entity) {
        this.entities.set(entity.id, this.copy(entity));
    }
    findById(id) {
        const found = this.entities.get(id);
        return found ? this.copy(found) : undefined;
    }
    list() {
        return [...this.entities.values()].map((entity) => this.copy(entity));
    }
    delete(id) {
        return this.entities.delete(id);
    }
    clear() {
        this.entities.clear();
    }
    copy(entity) {
        return structuredClone(entity);
    }
}
/** All-in-memory `PersistenceProvider`. Nothing survives process exit. */
export class InMemoryPersistence {
    tasks = new InMemoryRepository();
    agents = new InMemoryRepository();
    approvals = new InMemoryRepository();
    handoffs = new InMemoryRepository();
    auditEvents = new InMemoryRepository();
}
