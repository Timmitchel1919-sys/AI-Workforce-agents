# ADR-0024: Spatial Command Center (EO-5.7)

- Status: Accepted
- Date: 2026-09-26

## Context

The Spatial Graph (ADR-0023) is read-only. EO-5.7 lets an operator request
Control Plane actions from a selected node. The graph itself must never
execute anything: **VISUALIZATION != EXECUTION**, **GRAPH SELECTION != COMMAND
AUTHORIZATION**.

## Decision

### No second command system

Graph actions are a thin *client* of the existing governed path
`POST /api/commands/:name` (`WorkforceCommandService`): the server
authenticates, authorises (role capability **and** project scope), re-checks the
target's *current* state, executes through the domain subsystem, and writes a
`control_command` audit event. No new server route, command type or approval
system was added. The UI never talks to Git, Firebase, Firestore or a shell.

### Allowlist

Only five existing commands are reachable from the graph, and only where the
spec lists them for that node type (`ui/.../lib/nodeActions.ts`):

| Node | Command | Offered when (last confirmed state) |
|---|---|---|
| Task | `cancel-task` | not completed/cancelled |
| Task | `retry-task` | failed |
| Execution session | `cancel-execution` | created/validating/ready/running |
| Approval | `approve`, `reject` | requested |

Deliberately absent: `kill-execution` (admin emergency stop, stays in
Operations), agent enable/disable, workflow control, and everything the backend
does not support (pause task, retry execution, deployment control). Deployment,
agent, environment, commit, ChangeSet, verification and review nodes are
inspect-only. The server allowlist (`COMMAND_METHODS`) is checked with
`Object.hasOwn`, so inherited names (`constructor`, `__proto__`) are a clean 404.

The action list is a UX *hint* built from the node's last confirmed status and
the account's reported capabilities. A viewer, an unknown status or a missing
capability list yields no action. It grants no authority: the server decides.

### Flow and states

Select node → inspector lists actions (read-only inspection links are separate
from state-changing actions) → **explicit confirmation** (a real modal
alertdialog; initial focus on the *safe* choice; reason required for
cancel-execution and reject) → `Requesting…` → the server's structured result.

- Success is only an `executed` outcome; a 200 with anything else is reported as
  a failure (REQUESTED != EXECUTED). Cancelling a *running* session is shown as
  "requested, not finished".
- Failures are distinct: sign-in required, not authorized, invalid request,
  target not found / no longer current, not possible in current state, approval
  failure, command failed, network problem, **outcome unknown (timeout)**. A
  timeout is never retried automatically and tells the operator to check first.
- After the server answers (success or failure) the graph is re-read through the
  live channel; it is never updated optimistically.

### Safety properties

- **Stale target:** commands act on the domain id (`referenceId`), and each
  command re-checks current state server-side (cancel of a finished task, retry
  of a non-failed task, decision on an already-decided approval are refused with
  409).
- **Duplicates / concurrency:** one command in flight per panel; a second
  `confirm()` in the same tick or a different command is ignored. Server side,
  duplicate delivery is neutralised by the domain state machines (verified: two
  concurrent retries → one succeeds, one is 409). There are no idempotency
  keys; the state machine is the guard.
- **Audit:** every command (including denied and refused) produces one
  `control_command` event (actor, role, command, target, outcome, error kind,
  project, reason, correlation id). Spatial commands carry an `sg-` correlation
  id, preserved end to end, so their origin is visible in the audit trail.
- **Project switch:** command state is bound to the project; switching resets
  it and drops a late reply.
- **Focus Mode / a11y / mobile:** the command state machine and its dialog are owned
  by the *workspace*, not the inspector. The dialog is a direct child of the
  workspace root, so it is not confined by the inspector panel's `backdrop-filter`
  / `overflow` (which would clip a `position: fixed` overlay), is never made inert
  by Focus Mode, and is never over the canvas. A request in flight survives the
  inspector closing or the node being pruned by a live refresh, and its result
  is always shown. It traps Tab (including while requesting, when no button is
  focusable), and Escape closes only the dialog. All commands are DOM buttons in the inspector, so they are
  keyboard and screen-reader operable without touching WebGL. On narrow screens
  the dialog is a bottom sheet with 44px controls.

### Server-side defects found and fixed while building on the command path

(Reviews added: an approval past its `expiresAt` is refused and marked expired —
it previously stayed decidable until something else swept it; the project check
runs *before* the status check and the refusal names no project, so a scoped
operator learns neither another project's approval state nor its project name;
operator free text (`reason`, `note`) must be a string of at most 500
characters; a caller-supplied correlation id is kept only if it is ≤128 chars of
`[A-Za-z0-9_.:-]`, otherwise one is minted, so free-form text cannot be forged
into the audit trail. The UI also reports a recorded approval whose follow-up
(task/plan/workflow resume) failed as *not* plain success, and "already
terminal" cancels as "No change".)

1. **Cross-project approval (IDOR).** `decideApproval` derived an approval's
   project only from a linked task or plan. Approvals bound to commits/deployments
   carry it in `decisionMetadata.projectId` and were never project-checked: an
   operator scoped to project B could approve or reject project A's approval by
   id. It now honours the stamped project (the same attribution the approval
   queue uses) and **fails closed** for a project-scoped operator when an
   approval cannot be attributed to a project they can act on. Wildcard
   operators are unaffected.
2. **Prototype-name command lookup.** `POST /api/commands/constructor` returned
   500 (see above); now 404.

## Known limits

- **`retry-task` may be offered when the server will refuse it.** The server also
  refuses tasks that belong to a workflow, non-retryable failure reasons and
  exhausted retry counts; the graph node does not carry those facts, so the
  operator gets an honest 409 after confirming. A `retryable` hint in the
  projection would remove the misleading offer.
- **Residual idempotency risk:** duplicate delivery is neutralised by the domain
  state machines. A `retry-task` whose reply timed out, on a task that then
  failed *again*, could be applied twice if the operator retries. The UI reports
  timeouts as "outcome unknown" and never retries automatically.
- **Existence oracle:** a foreign task/approval id returns 403 while a missing one
  returns 404 (the established API contract, asserted by existing tests). Ids are
  sequential, so existence is enumerable; the response reveals nothing else.
- Task denial messages for cross-project cancel/retry still name the other project;
  approvals no longer do.

- Agent enable/disable (`disable-agent`/`enable-agent`) do **not** check project
  scope: an agent is global, and any role with the capability can toggle it
  regardless of `allowedProjects`. It is not reachable from the graph and was
  left unchanged, but it should be scoped in a follow-up.
- No idempotency-key layer; no "awaiting approval" command status, because none
  of the exposed commands is approval-gated. Approval nodes link to the
  Approvals module.
- There is no command palette in the codebase, so no palette integration.
