import type {
  Agent,
  Approval,
  AuditEvent,
  Entity,
  Handoff,
  PersistenceProvider,
  Repository,
  Task,
} from "../../contracts/index.js";

/**
 * Default `Repository` implementation. Holds entities in a `Map` for the life
 * of the process. Stores a structured-clone copy on write and returns a copy
 * on read so callers cannot mutate stored state by reference.
 *
 * This is the zero-configuration backend used by every core system when no
 * durable provider is injected. It is pure (no `fs`, no `node:` I/O) and lives
 * in `core/` deliberately.
 */
import { TenantIsolationContext } from "../tenancy/tenant-context.js";

export class InMemoryRepository<T extends Entity> implements Repository<T> {
  private readonly entities = new Map<string, T>();
  private readonly tenantContext = TenantIsolationContext.getInstance();

  constructor(seed: readonly T[] = []) {
    for (const entity of seed) this.upsert(entity);
  }

  private isAllowed(entity: T): boolean {
    const orgId = (entity as any).organizationId;
    if (!orgId) return true; // Legacy entities
    // In a real environment, we'd extract executionId from async local storage or parameter.
    // For now, we assume if tenant context exists for a global execution, we check it.
    // However, since we don't have executionId passed here, we might just expose a filter.
    return true;
  }

  upsert(entity: T): void {
    this.entities.set(entity.id, this.copy(entity));
  }

  findById(id: string): T | undefined {
    const found = this.entities.get(id);
    if (found && !this.isAllowed(found)) return undefined;
    return found ? this.copy(found) : undefined;
  }

  list(): T[] {
    return [...this.entities.values()]
      .filter((entity) => this.isAllowed(entity))
      .map((entity) => this.copy(entity));
  }

  delete(id: string): boolean {
    return this.entities.delete(id);
  }

  clear(): void {
    this.entities.clear();
  }

  private copy(entity: T): T {
    return structuredClone(entity);
  }
}

/** All-in-memory `PersistenceProvider`. Nothing survives process exit. */
export class InMemoryPersistence implements PersistenceProvider {
  readonly tasks = new InMemoryRepository<Task>();
  readonly agents = new InMemoryRepository<Agent>();
  readonly approvals = new InMemoryRepository<Approval>();
  readonly handoffs = new InMemoryRepository<Handoff>();
  readonly auditEvents = new InMemoryRepository<AuditEvent>();
}
