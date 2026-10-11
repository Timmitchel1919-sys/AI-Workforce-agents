import type {
  ProjectDependency,
  ProjectProfile,
  ResourceClaim,
} from "../../contracts/portfolio-intelligence.js";
import type { Repository } from "../../contracts/persistence.js";
import { InMemoryRepository } from "../persistence/in-memory-repository.js";
import type { PortfolioRepos } from "./service.js";

export * from "./health.js";
export * from "./service.js";

export function inMemoryPortfolioRepos(): PortfolioRepos {
  const r = <T extends { id: string }>() =>
    new InMemoryRepository<T>() as Repository<T>;
  return {
    profiles: r<ProjectProfile>(),
    dependencies: r<ProjectDependency>(),
    claims: r<ResourceClaim>(),
  };
}
