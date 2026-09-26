/**
 * EO-5.6 — ENVIRONMENT graph fragment. Pure: derives nodes/edges only from
 * authoritative routing verdicts and (optionally) the read-only registry.
 * Nothing is fabricated; instance nodes expose display-safe fields only.
 */
import type { GraphFragment } from "../../contracts/graph.js";
import type { TaskEnvironmentRoutingSummary } from "../../contracts/orchestration.js";
import type { EnvironmentRegistry } from "../environments/environment-registry.js";
export declare const MAX_INSTANCE_NODES = 20;
export interface EnvironmentFragmentInput {
    projectId: string;
    /** Already filtered to this project by the caller; still verify projectId. */
    tasks: readonly {
        id: string;
        projectId: string;
        environmentRequirements?: readonly string[];
    }[];
    /** Redacted routing verdicts from SoftwareFactoryOrchestrator.programDetail().routes. */
    routes: readonly TaskEnvironmentRoutingSummary[];
    /** Optional read-only registry view; absent => no instance nodes. */
    registry?: Pick<EnvironmentRegistry, "listInstances">;
}
export declare function buildEnvironmentFragment(input: EnvironmentFragmentInput): GraphFragment;
