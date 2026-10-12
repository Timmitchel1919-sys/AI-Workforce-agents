import { InMemoryRepository } from "../persistence/in-memory-repository.js";
export * from "./stats.js";
export * from "./service.js";
export function inMemoryAnalyticsRepos() {
    return {
        recommendations: new InMemoryRepository(),
        lessons: new InMemoryRepository(),
    };
}
