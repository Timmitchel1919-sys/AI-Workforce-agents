/**
 * Dependency planning — requirements only. Nothing here installs anything.
 *
 * Dependencies form a DAG: `toolchain:<kind>` nodes, `toolchain:<kind>:<name>`
 * component nodes (which depend on their toolchain), plus declared
 * toolchain-to-toolchain edges from the technology catalog. Duplicate
 * requirements merge to the highest minimum version. Resolution order is a
 * topological sort with an id tie-break (Kahn); cycles and references to
 * unknown nodes are reported as conflicts, never silently dropped.
 */
import { type DependencyPlan, type DependencyRequirement, type TechnologyRequirement } from "../../contracts/index.js";
import { type TechnologyCatalog } from "./technology-catalog.js";
export declare function dependencyRequirements(technologies: readonly TechnologyRequirement[], catalog: TechnologyCatalog): DependencyRequirement[];
/** Deterministic topological order + structured conflicts. */
export declare function planDependencies(items: readonly DependencyRequirement[]): DependencyPlan;
