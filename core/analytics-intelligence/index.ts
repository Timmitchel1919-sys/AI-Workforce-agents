import type {
  Lesson,
  Recommendation,
} from "../../contracts/analytics-intelligence.js";
import type { Repository } from "../../contracts/persistence.js";
import { InMemoryRepository } from "../persistence/in-memory-repository.js";
import type { AnalyticsRepos } from "./service.js";

export * from "./stats.js";
export * from "./service.js";

export function inMemoryAnalyticsRepos(): AnalyticsRepos {
  return {
    recommendations:
      new InMemoryRepository<Recommendation>() as Repository<Recommendation>,
    lessons: new InMemoryRepository<Lesson>() as Repository<Lesson>,
  };
}
