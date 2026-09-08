import type {
  AsyncRepository,
  Entity,
  Repository,
} from "../../contracts/index.js";
import { WorkforceError } from "../../contracts/index.js";
import { InMemoryRepository } from "./in-memory-repository.js";

/**
 * Bridges an {@link AsyncRepository} (a networked store — Firestore, SQL, an
 * HTTP API) to the synchronous {@link Repository} contract every core system is
 * built on, so the deterministic core lifecycle is never made async.
 *
 *   hydrate once  →  serve every read from memory  →  write through in order
 *
 * `hydrate()` must be awaited during wiring, before the repository is handed to
 * a core system. After that, reads are synchronous and local; writes update the
 * in-memory copy immediately and are flushed to the backing store on a
 * serialized queue. A backing-store write failure is reported through `onError`
 * (it does not throw into the caller, which has already observed the write
 * locally); `flush()` awaits the queue for graceful shutdown.
 *
 * Consistency: single-writer. One process owns the cache; concurrent writers to
 * the same backing store would drift. That is acceptable for the current
 * single-instance control API and is documented in ADR-0011.
 */
export interface CachedRepositoryOptions {
  /** Invoked when a write to the backing store fails. Defaults to a no-op. */
  onError?: (operation: "upsert" | "delete" | "clear", error: unknown) => void;
}

export class CachedRepository<T extends Entity> implements Repository<T> {
  private readonly cache = new InMemoryRepository<T>();
  private readonly onError: NonNullable<CachedRepositoryOptions["onError"]>;
  private hydrated = false;
  private queue: Promise<void> = Promise.resolve();
  private pending = 0;

  constructor(
    private readonly backing: AsyncRepository<T>,
    options: CachedRepositoryOptions = {},
  ) {
    this.onError = options.onError ?? (() => {});
  }

  /** Load the full backing collection into memory. Await before first use. */
  async hydrate(): Promise<this> {
    const all = await this.backing.list();
    this.cache.clear();
    for (const entity of all) this.cache.upsert(entity);
    this.hydrated = true;
    return this;
  }

  /** Number of backing-store writes not yet acknowledged. */
  get pendingWrites(): number {
    return this.pending;
  }

  /** Resolve once every queued backing-store write has settled. */
  async flush(): Promise<void> {
    await this.queue;
  }

  upsert(entity: T): void {
    this.assertHydrated();
    this.cache.upsert(entity);
    const snapshot = structuredClone(entity);
    this.enqueue("upsert", () => this.backing.upsert(snapshot));
  }

  findById(id: string): T | undefined {
    this.assertHydrated();
    return this.cache.findById(id);
  }

  list(): T[] {
    this.assertHydrated();
    return this.cache.list();
  }

  delete(id: string): boolean {
    this.assertHydrated();
    const existed = this.cache.delete(id);
    this.enqueue("delete", () => this.backing.delete(id));
    return existed;
  }

  clear(): void {
    this.assertHydrated();
    this.cache.clear();
    this.enqueue("clear", () => this.backing.clear());
  }

  private assertHydrated(): void {
    if (!this.hydrated) {
      throw new WorkforceError(
        "CachedRepository used before hydrate() completed",
      );
    }
  }

  private enqueue(
    operation: "upsert" | "delete" | "clear",
    run: () => Promise<unknown>,
  ): void {
    this.pending += 1;
    this.queue = this.queue
      .then(async () => {
        await run();
      })
      .catch((error: unknown) => {
        this.onError(operation, error);
      })
      .finally(() => {
        this.pending -= 1;
      });
  }
}
