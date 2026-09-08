/**
 * Composition helper: Firestore-backed, hydrate-once, write-through
 * `Repository<T>` instances for the control plane and the durable domain
 * collections.
 *
 *   Firestore collection → FirestoreRepository (AsyncRepository) → CachedRepository (sync Repository)
 *
 * The returned repositories drop straight into the existing constructors
 * (`AuditLog(sink, repo)`, `new AgentOperationalStore(repo)`, …) with no change
 * to `core/` or `control/`. Call `hydrateAll()` once before serving traffic and
 * `flushAll()` on shutdown. See ADR-0011.
 */
import type { Entity } from "../contracts/index.js";
import {
  firestoreRepository,
  type FirestoreLike,
} from "../adapters/firebase/index.js";
import {
  CachedRepository,
  type CachedRepositoryOptions,
} from "../core/index.js";

export interface FirebaseRepositoryProviderOptions {
  /** Prefix applied to every collection path (e.g. an environment namespace). */
  collectionPrefix?: string;
  /** Reported when a background write to Firestore fails. */
  onWriteError?: CachedRepositoryOptions["onError"];
}

export class FirebaseRepositoryProvider {
  private readonly repos = new Map<string, CachedRepository<Entity>>();
  private readonly prefix: string;
  private readonly onError: CachedRepositoryOptions["onError"] | undefined;

  constructor(
    private readonly firestore: FirestoreLike,
    options: FirebaseRepositoryProviderOptions = {},
  ) {
    this.prefix = options.collectionPrefix ?? "";
    this.onError = options.onWriteError;
  }

  /** A cached repository for a Firestore collection. Same instance per path. */
  repository<T extends Entity>(collectionPath: string): CachedRepository<T> {
    const cached = this.repos.get(collectionPath);
    if (cached) return cached as unknown as CachedRepository<T>;
    const async = firestoreRepository<T>(
      this.firestore,
      this.prefix + collectionPath,
    );
    const created = new CachedRepository<T>(
      async,
      this.onError ? { onError: this.onError } : {},
    );
    this.repos.set(
      collectionPath,
      created as unknown as CachedRepository<Entity>,
    );
    return created;
  }

  /** Hydrate every repository created so far. Await before serving traffic. */
  async hydrateAll(): Promise<void> {
    for (const repo of this.repos.values()) await repo.hydrate();
  }

  /** Await every pending background write. Call on graceful shutdown. */
  async flushAll(): Promise<void> {
    for (const repo of this.repos.values()) await repo.flush();
  }

  get pendingWrites(): number {
    let total = 0;
    for (const repo of this.repos.values()) total += repo.pendingWrites;
    return total;
  }
}
