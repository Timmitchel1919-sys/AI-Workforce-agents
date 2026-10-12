import type {
  BusinessObjective,
  BusinessProfile,
  DecisionRecord,
  Department,
  Initiative,
} from "../../contracts/business-layer.js";
import type { Repository } from "../../contracts/persistence.js";
import { InMemoryRepository } from "../persistence/in-memory-repository.js";
import type { BusinessRepos } from "./service.js";

export * from "./service.js";

export function inMemoryBusinessRepos(): BusinessRepos {
  const r = <T extends { id: string }>() =>
    new InMemoryRepository<T>() as Repository<T>;
  return {
    profile: r<BusinessProfile>(),
    departments: r<Department>(),
    objectives: r<BusinessObjective>(),
    initiatives: r<Initiative>(),
    decisions: r<DecisionRecord>(),
  };
}
export * from "./measure.js";
