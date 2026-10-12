import { InMemoryRepository } from "../persistence/in-memory-repository.js";
export * from "./service.js";
export function inMemoryBusinessRepos() {
    const r = () => new InMemoryRepository();
    return {
        profile: r(),
        departments: r(),
        objectives: r(),
        initiatives: r(),
        decisions: r(),
    };
}
export * from "./measure.js";
