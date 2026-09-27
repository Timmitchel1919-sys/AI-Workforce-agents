# ADR-0023: Live spatial execution visualization (EO-5.6)

- Status: Accepted
- Date: 2026-09-26

## Context

The Spatial Graph (EO-5) projected agents, tasks, workflows and environments,
and only refetched on mount or when the project/mode changed. The contract
already defined `EXECUTION_SESSION`, `CHANGESET`, `VERIFICATION`, `REVIEW`,
`APPROVAL`, `COMMIT` and `DEPLOYMENT` nodes, but the projection never emitted
them, so execution state was invisible. `ControlEventPublisher` has a single
caller (`command_result`), and `FirestoreEventPublisher` writes unindexed,
non-project-scoped events, so neither can serve as an isolated live channel.

## Decision

### Execution projection

1. `GraphQueryService.getWorkforceGraph` authorises first (`operatorCan` +
   `operatorCanAccessProject`), then — only for the `EXECUTION` and `AGENT`
   modes — reads lifecycle records through the **existing authorised,
   project-scoped Control Center reads with the caller's principal**
   (`ExecutionManager.listSessions/getChangeSet`, `VerificationService.listHistory`,
   `SourceControlOrchestrator.activity`, `DeploymentOrchestrator.listReleases`,
   `ApprovalSystem.get`). The graph never reads a store directly.
2. A pure builder (`core/orchestrator/graph-execution-fragment.ts`) projects
   those records. It fetches nothing, drops any record whose `projectId` differs,
   caps each family at `GRAPH_LIMITS.maxExecutionRecords`, and only emits an edge
   when an authoritative identifier links two existing nodes:
   `taskId`/`agentId` → session (`EXECUTES`), session → ChangeSet (`PRODUCES`),
   ChangeSet → verification/review/commit (`VERIFIED_BY`/`REVIEWED_BY`/`COMMITTED_AS`),
   record → approval (`REQUIRES_APPROVAL`), commit → release (`DEPLOYED_TO`, by the
   release's own `commitSha`). A node with no lifecycle parent hangs off the
   project (`CONTAINS`) so it stays reachable; no intermediate link is claimed.
3. Metadata is a whitelist of counts, statuses, timestamps and, for commits, the
   commit SHA and branch. Never file paths,
   file hashes, contents, operator identities, reviewer summaries, approval reasons or
   provider ids.
4. Each domain's status enum is normalised by an exhaustive typed table
   (`graph-execution-state.ts`). The same word can mean different things
   (`pending` is awaiting-review for a review, awaiting-approval for an approval,
   merely queued for a release), so the shared `toGraphState` map is not used.
   `deployed` (provider accepted) is distinct from `healthy` (post-deploy
   verified, mapped to `completed`): **DEPLOYED != VERIFIED**.
5. If a source read fails the projection reports `metadata.unavailableSources`
   and the UI says the missing activity is *unknown, not absent*. Error detail
   is not exposed. A source the deployment does not have at all is reported
   separately as `metadata.notConfiguredSources` (see ADR-0025: in production the
   release pipeline is not wired).
6. `contentRevision` now includes node metadata, so a metadata-only change
   (file count, attempt count) moves the revision. A read never mutates it.
7. `EXECUTION` is a new mode over the same projection (one architecture, many
   views). `AGENT` also shows sessions.

### Live transport: revision-conditional bounded polling

We chose polling over SSE / WebSockets / Firestore listeners:

- Firebase Hosting → Cloud Functions buffers and times out long-lived
  responses; the app already polls elsewhere.
- Every poll re-runs the full server-side authorisation and projection, so
  project isolation and authorisation are enforced per request, not once at
  connection time. A subscription channel would need its own authorisation and
  per-project fan-out and expiry logic.
- The graph is bounded (≤500 nodes), so "changed → resend the snapshot" needs no
  delta protocol, ordering protocol or event log.

`GET /api/projects/:id/graph?since=<revision>` runs authorisation and
projection in full, then answers `{unchanged: true, revision, generatedAt}`
when the revision matches. `since` can only save bandwidth. A malformed value is
a 400.

Revisions are content hashes, so they cannot order snapshots. The client
serialises requests (never two in flight per loop), applies a snapshot only if
its `generatedAt` is not older than the one held (**STALE != CURRENT**), and
validates every reply's `projectId`/`mode`/`revision` against what it asked.
Applying an identical snapshot again produces no transitions (idempotent).

### Client status and resilience

`useSpatialGraph` derives a status from what the transport actually did:
`live` (a snapshot confirmed and polling healthy), `refreshing` (initial/manual/
resume), `reconnecting` (1–2 consecutive failures), `degraded` (≥3, last-known
graph kept and labelled), `paused` (tab hidden, or live disabled) and `offline`.
A manual-only view is never `live`. Polls back off exponentially (capped), stop
while the tab is hidden, and re-ask immediately on return/online. Transition
history is diffed from server snapshots and hard-capped
(`LIVE_LIMITS.maxTransitions`). Project/mode switches start a new loop and the
old one is stopped; unmount clears timers.

The camera is refit only when the view (mode/root) changes, never for a routine
state change. Announcements are limited to degradation/recovery and real
transitions so a screen reader is not spammed.

### Changes from independent review

An independent security review (no BLOCKER/CRITICAL) and a correctness review
(five MAJOR) shaped the final design:

- **Terminal outcomes are not "unavailable".** `unavailable` means "no
  authoritative state". Cancelled, rolled-back and degraded are their own
  operational states; `cancelling` stays `running` until the sandbox confirms;
  a policy `denied` is `blocked` (it never ran); ChangeSet `verified` is
  `active`, not `completed` (verified is not committed).
- **Simulated deployments are labelled "(simulated)"** on the node, not only in
  metadata (VISUALIZATION != EXECUTION).
- **UNKNOWN != ABSENT in transitions too.** `diffGraphs` reports added/removed
  only when both snapshots are complete (not truncated, no unreadable source).
- **Per-poll cost is bounded.** Lifecycle records are shared across concurrent
  polls for a project for 3 s (promise-shared, max 64 projects, consulted only
  after authorisation). Sessions are sorted newest-first before the cap;
  ChangeSet reads settle individually. Approvals stamped for another project are
  dropped (defence in depth).
- **Revision covers what the client sees:** labels, edge status, truncation and
  the unreadable-source list are folded in, so `since` cannot answer "unchanged"
  across them.
- **Client validation:** full snapshots must carry a numeric revision and a
  `generatedAt` and match the requested project/mode. One older reply is
  discarded as stale; a persistent older reply is accepted (server clock behind)
  so the view never freezes. 401/403 stop polling until a manual refresh.
- **Execution path tracing:** selecting a node highlights its *ancestors* (walking
  edges backwards) and *descendants* (walking forwards) along real lifecycle edges,
  never mixing the two, so a shared agent or environment is not a pass-through
  hub to unrelated sibling work.
- **Announcements** count by an uncapped running total (the visible history is
  capped at 100), and one block builds each message so a recovery and a
  transition cannot overwrite each other.

## Known limits

- **Transition animation is not implemented.** Changes are conveyed by state
  colour/shape/glyph, the bounded "recent changes" list, path emphasis and
  screen-reader announcements — all of which work without motion, so reduced-motion
  needs no special case for live changes. Animating the scene is optional
  follow-up work.
- Polls are not jittered and have no `AbortController`; there is no
  freshness watchdog for a suspended timer beyond the visibility/online wake.
- `commit → verification` and `review → verification` are not projected (they
  are reachable through the ChangeSet).

## Consequences

- Live latency is one polling interval (5 s default), not push. Acceptable for
  operational state that changes on the order of seconds to minutes.
- Each poll costs one authorised projection; `listSessions` reconciles orphaned
  running sessions (an existing EO-4.8 behaviour), so a GET may commit a
  terminal transition for a session whose runner disappeared. That is existing
  authoritative reconciliation, not new behaviour.
- The `ControlEventPublisher`/Firestore channel remains unused by the graph and
  is not extended here.
- Read-only: nothing in this layer can change execution state. Command intents
  from the graph are EO-5.7 and must go through the Control Plane command path.
