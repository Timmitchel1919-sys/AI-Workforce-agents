import { type GraphFragment } from "../../contracts/graph.js";
import type { Approval, ChangeSet, CommitReceipt, ExecutionSession, ReleaseReceipt, ReviewRecord, VerificationResult } from "../../contracts/index.js";
/**
 * Authoritative execution-lifecycle records for ONE project, already fetched
 * through authorised control-plane reads. This module is pure: it never
 * fetches, never mutates, and never invents a record or a relationship.
 */
export interface ExecutionGraphRecords {
    sessions: readonly ExecutionSession[];
    changeSets: readonly ChangeSet[];
    verifications: readonly VerificationResult[];
    reviews: readonly ReviewRecord[];
    commits: readonly CommitReceipt[];
    releases: readonly ReleaseReceipt[];
    /** Approvals referenced by the records above, resolved by id. */
    approvals: readonly Approval[];
}
export declare const EMPTY_EXECUTION_RECORDS: ExecutionGraphRecords;
export interface ExecutionFragmentInput {
    projectId: string;
    projectNodeId: string;
    records: ExecutionGraphRecords;
    /**
     * Ids already present in the base graph. Edges to tasks, agents and
     * environment instances are only emitted when the endpoint really exists,
     * so the fragment can never dangle or reference another project's node.
     */
    existingNodeIds: ReadonlySet<string>;
    /** Maps a registry environment-instance id to its opaque graph node id. */
    environmentNodeId?: (instanceId: string) => string;
}
/** Stable graph ids. Exported so the UI/tests never re-derive them by hand. */
export declare const executionNodeId: {
    readonly session: (id: string) => string;
    readonly changeSet: (id: string) => string;
    readonly verification: (id: string) => string;
    readonly review: (id: string) => string;
    readonly approval: (id: string) => string;
    readonly commit: (id: string) => string;
    readonly deployment: (id: string) => string;
};
export declare function buildExecutionFragment(input: ExecutionFragmentInput): GraphFragment;
