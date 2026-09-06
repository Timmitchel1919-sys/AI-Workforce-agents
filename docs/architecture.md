# AI Workforce — Architecture

## 1. Overview

The AI Workforce is a **modular monolith** written in **TypeScript** and run on
**Node.js**. It provides the reliable primitives an AI agent workforce needs —
an agent registry, a deterministic task lifecycle, structured handoffs, a
minimal orchestrator, deny-by-default permissions, human approval records,
project-isolated context, and a structured audit log — behind **provider- and
project-agnostic contracts**.

Phase 1 is deliberately small. It contains no autonomous planning engine, no
persistence, no network calls, and no real project integrations. Every external
capability (a model provider, an external tool, a real project such as Money
Mind) enters only through an interface in [`contracts/`](../contracts/index.ts)
with an implementation under [`adapters/`](../adapters/).

## 2. Technology decision

| Concern | Choice | Why |
| --- | --- | --- |
| Language | TypeScript (strict) | Strong contracts, compiler-enforced state machines, refactor safety. |
| Runtime | Node.js ≥ 20 | Ubiquitous, first-class TypeScript tooling, built-in test runner. |
| Module system | ESM (`NodeNext`) | Matches modern Node; explicit `.js` import specifiers. |
| Tests | `node:test` + `node:assert/strict` | Zero dependencies, deterministic, fast. |
| Build | `tsc` only | No bundler needed for a library-shaped core. |
| Runtime dependencies | **none** | Smaller attack surface, nothing to audit, nothing to lock into. |
| Lint | `tsc --noEmit` (strict) | ESLint deliberately deferred to avoid an early dependency; strict TypeScript already blocks the common mistakes. |

See [ADR-0001](adr/0001-modular-provider-agnostic-workforce.md) for the full
decision record.

## 3. Module map

```
contracts/index.ts          Types + pure validators. No runtime dependencies.
core/
  shared.ts                 Deterministic id + time helpers.
  registry/agent-registry   AgentRegistry — declarative agent store & lookup.
  tasks/task-system         TaskSystem — deterministic task lifecycle.
  handoffs/handoff-system   HandoffSystem — propose / accept / reject handoffs.
  permissions/permission-system  PermissionSystem — deny-by-default evaluation.
  approvals/approval-system  ApprovalSystem — human approval records.
  context/context-system    ContextSystem — project-isolated task/project/agent context.
  audit/audit-log           AuditLog + AuditSink — structured local audit events.
  orchestrator/orchestrator  Orchestrator — validate → route → dispatch → record.
  index.ts                  Barrel export for the whole core.
adapters/
  models/model-provider     ModelProvider contract + EchoModelProvider double.
  tools/tool-provider       ToolProvider contract + InMemoryToolProvider double.
  projects/project-adapter  ProjectAdapter contract + BaseProjectAdapter helper.
  index.ts                  Barrel export for adapters.
tests/foundation.test.ts    Deterministic tests for every component.
docs/                       This documentation + ADR.
```

Dependency direction is one-way: `adapters → contracts` and `core → contracts`.
`core` never imports from `adapters`; the orchestrator receives an
`AgentExecutor` by constructor injection.

## 4. Core components

### AgentRegistry
Stores **declarative** agent definitions. On `register` it runs `validateAgent`
(non-blank identity, non-empty capabilities, well-formed permission grants,
string model policy), stores a frozen copy, and rejects duplicate ids. Lookups:
`get`, `byCapability`, and `eligible(taskType, projectId)` which returns agents
whose `supportedTaskTypes` **and** `allowedProjects` both admit the task.
Ordering is deterministic (by id).

### TaskSystem
Owns the task lifecycle and is the single writer of task state. `create`
validates the draft and applies deterministic defaults. `transition` consults a
static transition table and throws `StateTransitionError` on any illegal move.
Convenience methods: `assign`, `complete`, `fail`, `cancel`.

### HandoffSystem
Models an explicit two-step handshake. `propose` validates structure and stores
the handoff as `proposed`. `accept` re-validates and marks it `accepted`;
`reject` records a reason. Nothing is considered transferred until acceptance.

### Orchestrator
The only component that coordinates the others. `submit` creates and queues a
task, finds eligible agents, selects one deterministically (pluggable
`AgentSelector`, default = lowest id), dispatches to the injected
`AgentExecutor`, and records an audit event at every step. If no agent is
eligible the task is moved to `blocked`. `requestHandoff` checks both agents are
registered and the task exists, then drives `propose` + `accept`. There is no
planning, retry loop, or autonomy here by design.

### PermissionSystem
Deny-by-default. A `PermissionRequest` is scoped by agent, project, tool,
action, and environment. A grant matches when its action equals the request
action and every scope field it specifies matches (unspecified = wildcard).
Precedence: **explicit deny > explicit allow > implicit deny**. `assert` throws
`PermissionDeniedError` when a request is not allowed.

### ApprovalSystem
Records human decisions only — it never grants access itself. States:
`requested → approved | rejected | expired`. Records carry id, action,
requester, reason, status, timestamps, and `decisionMetadata`. `expireStale`
expires pending approvals whose `expiresAt` has passed. A future UI/API layer
drives `decide` / `expire`.

### ContextSystem
Three scopes — task, project, agent — each **bound to a project**. Reads require
the caller to name the project and return nothing on mismatch. `viewForProject`
returns only that project's contexts and never spans projects. Returned values
are deep-copied so callers cannot mutate stored state. There is no global shared
memory.

### AuditLog
`record(type, fields)` builds a structured `AuditEvent` (id, type, ISO
timestamp, optional task/agent/project ids, `data`) and writes it to a pluggable
`AuditSink` (`InMemoryAuditSink` by default). `query` filters by type / task /
agent / project. Covered event types: `task_created`, `task_assigned`,
`agent_executed`, `handoff_created`, `permission_decision`,
`approval_requested`, `approval_decided`, `task_completed`, `task_failed`.

## 5. Lifecycles

### Agent lifecycle
`define (plain object) → validateAgent → register → frozen in registry → matched
by eligible()/byCapability() → selected by the orchestrator`. Agents are
data; they are never mutated after registration.

### Task lifecycle
```
created ──▶ queued ──▶ running ──▶ completed        (terminal)
   │          │          │
   │          ├──▶ blocked ──▶ queued | running
   │          └──▶ awaiting_approval ──▶ running | queued | failed
   │          │
   ▼          ▼
cancelled   failed ──▶ queued        (retry)
```
`completed` and `cancelled` are terminal. Illegal transitions throw.

### Handoff lifecycle
`propose (validated) → proposed → accept (re-validated) → accepted` or
`→ reject(reason) → rejected`. Only the source/destination pair, task id, work
summaries, and acceptance criteria are required; artifacts and risks are
optional lists.

### Approval lifecycle
`request → requested → decide("approved"|"rejected") | expire → terminal`.
Deciding a non-pending approval throws.

## 6. Permissions model

Least privilege is expressed on the agent (`allowedTools`, `allowedProjects`,
`permissions`) and enforced at call time by `PermissionSystem`. Nothing is
implicitly permitted. Grants should be as narrow as possible — prefer a grant
scoped to a single agent + project + environment over a broad action-only
grant, and add explicit `deny` grants for high-risk combinations (e.g. `deploy`
in `production`).

## 7. Context isolation

Project context is isolated by default. A task is permanently bound to the first
project it is stored under; rebinding throws. Agent context is stored per
`(project, agent)` pair. No API returns context across project boundaries. This
keeps AIMS, Money Mind, Mastery, and Tripod data from leaking between projects
even when the same agent works on several of them.

## 8. Provider adapters

`ModelProvider` and `ToolProvider` are provider-neutral. The core never imports
a vendor SDK; a concrete provider is injected at wiring time. Phase 1 ships two
in-process doubles used only by tests and local wiring:

- `EchoModelProvider` — deterministic, offline, echoes the last message.
- `InMemoryToolProvider` — dispatches to an explicit handler map; unknown tools
  throw. No shell, filesystem, or credential access.

OpenAI / Anthropic / Google providers are added later as new files under
`adapters/models/` that implement `ModelProvider`.

## 9. Project adapters

`ProjectAdapter` gives controlled access to one real project through a fixed,
**declared** capability list. `BaseProjectAdapter` enforces the contract: a
stable `projectId`, `describe()` derived from declared operations, and
`execute()` that rejects any operation not declared. Project source code is
never copied into this repository — an adapter calls out to the project's own
API/CLI when it is eventually implemented.

## 10. Testing

`npm test` compiles with `tsc` and runs `node --test` over the compiled output.
`tests/foundation.test.ts` covers agent registration/lookup/validation, task
creation and (in)valid transitions, handoff validation, permission denial and
approval, the approval lifecycle, project isolation, audit events and queries,
the provider/adapter contracts, and orchestrator routing/blocking/failure/
handoff. Every test is deterministic and offline — **no real AI API calls**.

## 11. Extension guidelines

See [extending.md](extending.md). In short: add capability behind its contract,
grant least privilege, add deterministic tests, and never let `core` depend on
an adapter or a concrete provider.

## 12. Deliberately out of scope for Phase 1

Persistence / durable storage, real authentication, asynchronous workers or
queues, retries and backoff, autonomous planning, network I/O, external logging
or telemetry infrastructure, and any real project integration.
