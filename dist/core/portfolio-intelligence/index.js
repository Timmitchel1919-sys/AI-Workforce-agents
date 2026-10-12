import { InMemoryRepository } from "../persistence/in-memory-repository.js";
export * from "./health.js";
export * from "./service.js";
export function inMemoryPortfolioRepos() {
    const r = () => new InMemoryRepository();
    return {
        profiles: r(),
        dependencies: r(),
        claims: r(),
    };
}
