import type { Agent, Approval, AuditEvent, Entity, PersistenceProvider, Handoff, Repository, Task } from "../../contracts/index.js";
export declare class JsonFileRepository<T extends Entity> implements Repository<T> {
    private readonly filePath;
    private readonly entities;
    constructor(filePath: string);
    upsert(entity: T): void;
    findById(id: string): T | undefined;
    list(): T[];
    delete(id: string): boolean;
    clear(): void;
    private load;
    private flush;
}
/**
 * `PersistenceProvider` backed by JSON files under a single directory.
 *
 * @param directory folder that will hold `tasks.json`, `agents.json`, etc.
 */
export declare class JsonFilePersistence implements PersistenceProvider {
    readonly tasks: Repository<Task>;
    readonly agents: Repository<Agent>;
    readonly approvals: Repository<Approval>;
    readonly handoffs: Repository<Handoff>;
    readonly auditEvents: Repository<AuditEvent>;
    constructor(directory: string);
}
