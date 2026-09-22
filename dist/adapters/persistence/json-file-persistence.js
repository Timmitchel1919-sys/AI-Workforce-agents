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
export class JsonFileRepository {
    filePath;
    entities = new Map();
    constructor(filePath) {
        this.filePath = filePath;
        mkdirSync(dirname(filePath), { recursive: true });
        this.load();
    }
    upsert(entity) {
        this.entities.set(entity.id, structuredClone(entity));
        this.flush();
    }
    findById(id) {
        const found = this.entities.get(id);
        return found ? structuredClone(found) : undefined;
    }
    list() {
        return [...this.entities.values()].map((entity) => structuredClone(entity));
    }
    delete(id) {
        const existed = this.entities.delete(id);
        if (existed)
            this.flush();
        return existed;
    }
    clear() {
        this.entities.clear();
        this.flush();
    }
    load() {
        let raw;
        try {
            raw = readFileSync(this.filePath, "utf8");
        }
        catch (error) {
            if (error.code === "ENOENT")
                return;
            throw error;
        }
        const parsed = JSON.parse(raw);
        if (parsed.version !== 1 || typeof parsed.entities !== "object") {
            throw new Error(`unrecognized persistence file: ${this.filePath}`);
        }
        for (const [id, entity] of Object.entries(parsed.entities)) {
            this.entities.set(id, entity);
        }
    }
    flush() {
        const payload = {
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
export class JsonFilePersistence {
    tasks;
    agents;
    approvals;
    handoffs;
    auditEvents;
    constructor(directory) {
        mkdirSync(directory, { recursive: true });
        this.tasks = new JsonFileRepository(join(directory, "tasks.json"));
        this.agents = new JsonFileRepository(join(directory, "agents.json"));
        this.approvals = new JsonFileRepository(join(directory, "approvals.json"));
        this.handoffs = new JsonFileRepository(join(directory, "handoffs.json"));
        this.auditEvents = new JsonFileRepository(join(directory, "audit-events.json"));
    }
}
