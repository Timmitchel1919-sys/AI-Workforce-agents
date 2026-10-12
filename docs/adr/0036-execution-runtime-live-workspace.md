# ADR-0036: Execution Runtime & Live Development Workspace (Layer 5)

## Status

Accepted (Layer 5)

## Context

Layer 4 decides what runs, with which agent, model and tools. Layer 5 performs
the work inside a controlled project workspace and lets the user watch it. The
platform is private and single-user; no tenancy or enterprise features are added.

## What already existed (reused)

`ExecutionManager`, sandbox registry, workspace tools, `VerificationService`,
`SourceControlOrchestrator`, `DeploymentOrchestrator`, `GovernedGitPort` (EO-4.x) —
all fail-closed in production (no runner, no persistent workspace, no Git). The
`ApprovalSystem`, `AuditLog` (`execution_event`), the Layer 4 `TaskRuntimePort`,
the Layer 3 secret scanner and the Cost Center (model usage is recorded against the
task id by the budget-governed provider; the runtime adds no second calculation).

## Decision

`GovernedTaskRuntime` implements the Layer 4 `TaskRuntimePort`:

```
task → session (CREATED→INITIALIZING→READY→RUNNING→REVIEWING→SUCCEEDED | FAILED | CANCELLED | TIMED_OUT | PAUSED)
     → explicit workspace resolution → project-isolation check
     → AgentToolSession (only Layer 4–authorized tools) → work → structured result
     → Layer 4 VERIFIES the claim.
```

- **Workspace**: never assumed. A project needs a registered binding (trusted
  configuration); the host path never leaves the module; a root cannot be shared
  between projects.
- **Path guard**: absolute, `..`, NUL, drive/UNC and symlink/junction escapes are
  refused; credential files are neither listed, read nor written; `.git` and
  `node_modules` are not writable.
- **Command policy**: no shell. Free text is classified SAFE / REVIEW_REQUIRED /
  BLOCKED and only allow-listed SAFE commands become a structured `CommandSpec`
  (declared npm validation scripts, read-only git). Installs, arbitrary scripts,
  commit, push and deploy are never run from the agent surface.
- **Process runner**: fixed argv, scrubbed environment, timeout, cancellation
  (process tree), bounded output, secrets masked in linear time.
- **Files**: read/list/create/update/rename/move/delete with hash-checked updates,
  change tracking, masked bounded diffs; delete needs the task's own approval.
- **Change scope protection**: net changes are compared with the task's expected
  files; unexpected (and sensitive) modifications are flagged, the review is
  mechanically forced to "changes requested", nothing is discarded automatically.
- **Validation pipeline**: typecheck → lint → test → build with parsed counts; a
  missing test/build script is "unavailable", not a pass. Failures return the real
  error text to the correction loop.
- **Git**: commit stages exactly the run's net changed files, hooks disabled,
  refused unless validation passed after the last change and the scope is clean;
  push is fast-forward to the bound repository/branch only.
- **Deployment** is a hand-off port, never a command.
- **Events**: bounded, masked, sequence-numbered, persisted with the session,
  delivered by long-poll (`after=<seq>&wait=`) so the UI needs no fixed polling.
- **Recovery**: state is persisted; a stale heartbeat fails an interrupted session
  with its logs preserved; a paused session is resumed, not duplicated.
- **Limits**: output, read size, events, commands, file operations, concurrency.

## Known gaps (reported, not hidden)

- **Production has no workspace, runner or agent executor.** Tasks report
  "no workspace is registered" and block. A local host registers workspaces.
- **No LLM agent loop** exists: authoring, semantic review and security review go
  through `AgentExecutorPort`; with none configured they report that honestly.
- Not wired to the EO-4 orchestrators (`SourceControlOrchestrator`,
  `DeploymentOrchestrator`); the deployment hand-off and git are ports.
- Only the `local` environment is implemented (interfaces allow Docker/cloud/WSL).
- Pause/resume works at tool-call boundaries; there is no live preview.
- Sessions are per-instance in memory with a durable write-through (no cross-instance
  coordination).
