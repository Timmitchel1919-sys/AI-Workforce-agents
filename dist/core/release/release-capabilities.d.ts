import type { ReleaseCapabilities } from "../../contracts/index.js";
export interface ReleaseCapabilityInputs {
    sandboxes: {
        list(): readonly string[];
    };
    operations: {
        list(): readonly unknown[];
    };
    /** The ports the release services were composed with. `available === false` marks a stand-in. */
    git: {
        readonly available?: boolean;
    };
    workspace: {
        readonly available?: boolean;
    };
    artifactSource: {
        readonly available?: boolean;
    };
    deployments: {
        adapterIds(): readonly string[];
    };
}
/**
 * The release capabilities of a composition, DERIVED — never declared:
 *
 *  - `verification`: a sandbox provider AND registered operations exist AND the workspace and
 *    artifact source are real. (A sandbox with an unavailable workspace cannot verify anything, so
 *    it must not advertise verification.)
 *  - `sourceControl`: a real Git port AND a real workspace.
 *  - `deploymentAdapters`: the adapters actually registered with the deployment orchestrator.
 *
 * Every field is a getter, evaluated when READ, so a registry that changes after composition (a
 * provider or adapter registered later) is reflected instead of a stale construction-time snapshot.
 */
export declare function deriveReleaseCapabilities(i: ReleaseCapabilityInputs): ReleaseCapabilities;
