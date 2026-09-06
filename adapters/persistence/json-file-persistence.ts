/**
 * Durable local persistence: one JSON file per collection.
 *
 * This adapter is the simplest reliable local store that keeps the project
 * dependency-free (see ADR-0002). Every mutation rewrites the whole file
 * atomically (write to a temp file, then `renameSync`). A repository loads its
 * file into memory on construction, so a fresh instance pointed at the same
 * file transparently "resumes" previous state.
 *
 * It is infrastructure — it uses `node:fs` — and therefore lives under
 * `adapters/`. Core never imports it; wire it in at the application entry
 * point or in a test.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type {
  Agent,
  Approval,
  AuditEvent,
  Entity,
  PersistenceProvider,
  Handoff,
  Repository,
  Task,
} from "../../contracts/index.js";

interface FileShape<T> {
  version: 1;
  entities: Record<string, T>;
}

export class JsonFileRepository<T extends Entity> implements Repository<T> {
  private readonly entities = new Map<string, T>();

  constructor(private readonly filePath: string) {
    mkdirSync(dirname(filePath), { recursive: true });
    this.load();
  }

  upsert(entity: T): void {
    this.entities.set(entity.id, structuredClone(entity));
    this.flush();
  }

  findById(id: string): T | undefined {
    const found = this.entities.get(id);
    return found ? structuredClone(found) : undefined;
  }

  list(): T[] {
    return [...this.entities.values()].map((entity) => structuredClone(entity));
  }

  delete(id: string): boolean {
    const existed = this.entities.delete(id);
    if (existed) this.flush();
    return existed;
  }

  clear(): void {
    this.entities.clear();
    this.flush();
  }

  private load(): void {
    let raw: string;
    try {
      raw = readFileSync(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    const parsed = JSON.parse(raw) as FileShape<T>;
    if (parsed.version !== 1 || typeof parsed.entities !== "object") {
      throw new Error(`unrecognized persistence file: ${this.filePath}`);
    }
    for (const [id, entity] of Object.entries(parsed.entities)) {
      this.entities.set(id, entity);
    }
  }

  private flush(): void {
    const payload: FileShape<T> = {
      version: 1,
      entities: Object.fromEntries(this.entities),
    };
    const tempPath = `${this.filePath}.tmp`;
    writeFileSync(tempPath, JSON.stringify(payload, null, 2), "utf8");
    renameSync(tempPath, this.filePath);
  }
}

/**
 * `PersistenceProvider` backed by JSON files under a single directory.
 *
 * @param directory folder that will hold `tasks.json`, `agents.json`, etc.
 */
export class JsonFilePersistence implements PersistenceProvider {
  readonly tasks: Repository<Task>;
  readonly agents: Repository<Agent>;
  readonly approvals: Repository<Approval>;
  readonly handoffs: Repository<Handoff>;
  readonly auditEvents: Repository<AuditEvent>;

  constructor(directory: string) {
    mkdirSync(directory, { recursive: true });
    this.tasks = new JsonFileRepository<Task>(join(directory, "tasks.json"));
    this.agents = new JsonFileRepository<Agent>(join(directory, "agents.json"));
    this.approvals = new JsonFileRepository<Approval>(
      join(directory, "approvals.json"),
    );
    this.handoffs = new JsonFileRepository<Handoff>(
      join(directory, "handoffs.json"),
    );
    this.auditEvents = new JsonFileRepository<AuditEvent>(
      join(directory, "audit-events.json"),
    );
  }
}
