import type { OrchTask } from "../../contracts/execution-orchestration.js";
export declare function validatePlan(tasks: readonly OrchTask[]): void;
/** All transitive upstream task ids of `taskId`. */
export declare function upstreamOf(tasks: readonly OrchTask[], taskId: string): Set<string>;
/** Number of tasks that (transitively) wait on `taskId` — its criticality. */
export declare function dependentCount(tasks: readonly OrchTask[], taskId: string): number;
/** PENDING tasks whose dependencies are all COMPLETED. */
export declare function readyCandidates(tasks: readonly OrchTask[]): OrchTask[];
/** Do two tasks write the same exclusive resource? */
export declare function conflicts(a: OrchTask, b: OrchTask): boolean;
/** Choose up to `limit` tasks that can safely run together (no shared writes). */
export declare function parallelBatch(ordered: readonly OrchTask[], limit: number): OrchTask[];
