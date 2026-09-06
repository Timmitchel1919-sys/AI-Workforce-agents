# AI Workforce — Architecture

## 1. Overview

The AI Workforce is a **modular monolith** written in **TypeScript** and run on
**Node.js**. It provides the reliable primitives an AI agent workforce needs —
an agent registry, a deterministic task lifecycle, structured handoffs, a
minimal orchestrator, deny-by-default permissions enforced at the dispatch
boundary, human approval gates, project-isolated context, a structured audit
log, and durable persistence behind an interface — all behind **provider- and
project-agnostic contracts**.

As of Phase 2B there is a real model-provider adapter (Anthropic), but still no
autonomous planning engine and no real project integration. Every external
capability (a model provider, an external tool, a real project such as Money
Mind, a database) enters only through an interface in
[`contracts/`](../contracts/index.ts) with an implementation under
[`adapters/`](../adapters/). The core imports no vendor SDK.

## 2. Technology decisions

| Concern              | Choice                                      | Why                                                                                                                                                                                             |
| -------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language             | TypeScript (strict)                         | Strong contracts, compiler-enforced state machines, refactor safety.                                                                                                                            |
| Runtime              | Node.js ≥ 20                                | Ubiquitous, first-class TypeScript tooling, built-in test runner.                                                                                                                               |
| Module system        | ESM (`NodeNext`)                            | Matches modern Node; explicit `.js` import specifiers.                                                                                                                                          |
| Tests                | `node:test` + `node:assert/strict`          | Zero dependencies, deterministic, fast.                                                                                                                                                         |
| Build                | `tsc` only                                  | No bundler needed for a library-shaped core.                                                                                                                                                    |
| Runtime dependencies | **none in core**                            | Smaller attack surface. The only SDK, `@anthropic-ai/sdk`, is an **optional peer dependency** used solely by the Anthropic adapter. See [ADR-0004](adr/0004-model-provider-layer-anthropic.md). |
| Persistence          | `Repository<T>` interface; JSON files first | Durable without coupling the core to a DB. See [ADR-0002](adr/0002-local-json-file-persistence.md).                                                                                             |
| Lint / format        | ESLint 9 (syntactic) + Prettier 3, dev-only | Real value now the codebase has grown. `tsc` stays the type gate. See [ADR-0003](adr/0003-code-quality-tooling.md).                                                                             |
| CI                   | GitHub Actions (Node 20 + 22)               | typecheck → lint → format → test → build on push/PR. No secrets.                                                                                                                                |

See [ADR-0001](adr/0001-modular-provider-agnostic-workforce.md) for the
foundational architecture decision.

## 3. Module map

```
contracts/
  index.ts                  Types + pure validators. No runtime dependencies.
  persistence.ts            Repository<T> + PersistenceProvider interfaces.
core/
  shared.ts                 Deterministic id + time helpers.
  persistence/in-memory-repository   InMemoryRepository / InMemoryPersistence (pure, default).
  registry/agent-registry   AgentRegistry — declarative agent store & lookup.
  tasks/task-system         TaskSystem — deterministic task lifecycle.
  handoffs/handoff-system   HandoffSystem — propose / accept / reject handoffs.
  permissions/permission-system  PermissionSystem — deny-by-default evaluation.
  approvals/approval-system  ApprovalSystem — human approval records.
  context/context-system    ContextSystem — project-isolated task/project/agent context.
  audit/audit-log           AuditLog + AuditSink — structured audit events, optionally persisted.
  providers/model-provider-registry  ModelProviderRegistry — resolve providers by id (provider-neutral).
  providers/audited-model-provider   AuditedModelProvider — audit decorator around any ModelProvider.
  orchestrator/orchestrator  Orchestrator — validate → permit → gate → dispatch → record.
  index.ts                  Barrel export for the whole core.
adapters/
  models/model-provider     ModelProvider contract + EchoModelProvider double.
  models/anthropic-model-provider  AnthropicModelProvider + config + transport seam + error mapping.
  tools/tool-provider       ToolProvider contract + InMemoryToolProvider double.
  projects/project-adapter  ProjectAdapter contract + BaseProjectAdapter helper.
  persistence/json-file-persistence  JsonFileRepository / JsonFilePersistence (durable, node:fs).
  index.ts                  Barrel export for adapters.
tests/
  foundation.test.ts        Every Phase 1 component.
  persistence.test.ts       Repository save/load/update/isolation, survives reinit.
  approval-execution.test.ts  Approval gate, resume, reject, expiry, persistence.
  permission-enforcement.test.ts  Allowed/denied dispatch, every permission scope.
  anthropic-provider.test.ts  Config, request/response mapping, every failure class, redaction.
  model-provider-layer.test.ts  Registry, audit decorator, provider independence, core isolation.
docs/                       This documentation + ADRs.
.env.example                Placeholder environment configuration (never a real .env).
.github/workflows/ci.yml    Continuous integration.
```

Dependency direction is one-way: `adapters → contracts` and `core → contracts`.
`core` never imports from `adapters`. The orchestrator, every core system's
`Repository`, the `AgentExecutor`, the `ApprovalPolicy`, and the
`PermissionSystem` are all supplied by constructor injection.

## 4. Core components

### AgentRegistry

Stores **declarative** agent definitions. On `register` it runs `validateAgent`
(non-blank identity, non-empty capabilities, well-formed permission grants,
string model policy), persists an immutable copy through its `Repository`, and
rejects duplicate ids. Lookups: `get`, `byCapability`, and
`eligible(taskType, projectId)`. Ordering is deterministic (by id).

### TaskSystem

Owns the task lifecycle and is the single writer of task state (through its
`Repository`). `create` validates the draft and applies deterministic defaults,
including `requiredPermissions: []`. `transition` consults a static transition
table and throws `StateTransitionError` on any illegal move. Convenience
methods: `assign`, `complete`, `fail`, `cancel`. A task also carries an
`approvalId` while it sits in `awaiting_approval`.

### HandoffSystem

Explicit two-step handshake: `propose` (validates, stores `proposed`) →
`accept` (re-validates, `accepted`) or `reject(reason)`. Nothing is transferred
until acceptance. Backed by a `Repository`.

### Orchestrator

The only component that coordinates the others. `submit`:

1. create task → audit `task_created`
2. transition `queued`
3. eligible agents? none → `blocked` + audit; otherwise select deterministically
   (pluggable `AgentSelector`, default = lowest id) → `assign` → audit
   `task_assigned`
4. **permission gate** — assert every `task.requiredPermissions` entry against
   the injected `PermissionSystem`; audit each `permission_decision`; on denial
   fail the task (executor never called) with a `PermissionDeniedError` message
5. **approval gate** — ask the `ApprovalPolicy`; if approval is required, create
   an approval request, audit `approval_requested`, transition the task to
   `awaiting_approval`, and **stop**
6. otherwise `dispatch`: audit `agent_executed`, run the `AgentExecutor` (handed
   a `PermissionGuard`), then `task_completed` or `task_failed`

`recordApprovalDecision(approvalId, decision, decidedBy)` applies an **externally
supplied** human decision and audits `approval_decided` — it never auto-approves.

`resume(taskId, { asOf? })` re-enters a parked task: it reads the approval
(optionally expiring stale ones as of `asOf`), audits `task_resumed`, then
either dispatches (approved) or fails the task (`rejected` / `expired`).
Resuming with no decision yet throws.

`requestHandoff` checks both agents are registered and the task exists, then
drives `propose` + `accept` and audits `handoff_created`. No planning, retry
loop, or autonomy here by design.

### PermissionSystem

Deny-by-default. A `PermissionRequest` is scoped by agent, project, tool,
action, and environment. A grant matches when its action equals the request
action and every scope field it specifies matches (unspecified = wildcard).
Precedence: **explicit deny > explicit allow > implicit deny**. `evaluate`
returns a decision; `assert` throws `PermissionDeniedError`. The orchestrator
calls it at the dispatch boundary and also exposes it to executors via
`PermissionGuard`.

### ApprovalSystem

Records human decisions only — it never grants access and never auto-approves.
States: `requested → approved | rejected | expired`. Records carry id, action,
requester, reason, status, timestamps, and `decisionMetadata`. `expireStale`
expires pending approvals whose `expiresAt` has passed. Backed by a
`Repository`.

### ContextSystem

Three scopes — task, project, agent — each **bound to a project**. Reads require
the caller to name the project and return nothing on mismatch. `viewForProject`
never spans projects. Returned values are deep-copied. No global shared memory.
(In-memory only; not part of the persistence boundary in Phase 2A.)

### AuditLog

`record(type, fields)` builds a structured `AuditEvent` (id, type, ISO
timestamp, optional task/agent/project ids, `data`), writes it to a pluggable
`AuditSink` (`InMemoryAuditSink` by default), retains it for `query`, and — when
a `Repository<AuditEvent>` is supplied — persists it. Event types:
`task_created`, `task_assigned`, `agent_executed`, `handoff_created`,
`permission_decision`, `approval_requested`, `approval_decided`, `task_resumed`,
`task_completed`, `task_failed`, `model_provider_requested`,
`model_execution_started`, `model_execution_completed`,
`model_execution_failed`.

### Persistence

`Repository<T>` (`upsert` / `findById` / `list` / `delete` / `clear`,
synchronous) is the only persistence type the core knows.
`InMemoryRepository` (pure, in `core/`) is the zero-config default.
`JsonFileRepository` / `JsonFilePersistence` (in `adapters/`, uses `node:fs`)
provide a durable local store: one JSON file per collection, loaded on
construction, rewritten atomically on every mutation. A fresh instance pointed
at the same directory resumes prior state. See
[ADR-0002](adr/0002-local-json-file-persistence.md).

## 5. Lifecycles

### Agent lifecycle

`define (plain object) → validateAgent → register (persisted, frozen) → matched
by eligible()/byCapability() → selected by the orchestrator`. Agents are data;
never mutated after registration.

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

`completed` and `cancelled` are terminal. Illegal transitions throw. A
permission denial sends the task straight to `failed` before dispatch. An
approval requirement parks it in `awaiting_approval` until `resume`.

### Handoff lifecycle

`propose (validated) → proposed → accept (re-validated) → accepted`, or
`→ reject(reason) → rejected`.

### Approval lifecycle

`request → requested → decide("approved"|"rejected") | expire → terminal`.
Deciding a non-pending approval throws. The orchestrator observes the terminal
state on `resume`.

### Approval-gated execution (end to end)

```
submit ─▶ queued ─▶ assigned ─▶ [permission gate] ─▶ [approval policy]
                                                          │ required
                                                          ▼
                              approval_requested + task → awaiting_approval  (STOP)
                                                          │
                         human: recordApprovalDecision(...)│  (external, never automatic)
                                                          ▼
                         resume ─▶ task_resumed ─▶ approved? ─▶ running ─▶ dispatch
                                                  rejected/expired ─▶ failed
```

## 6. Permissions model & enforcement

Least privilege is declared on the agent (`allowedTools`, `allowedProjects`,
`permissions`) and on the task (`requiredPermissions`). Enforcement happens at
the **dispatch boundary**: before an agent runs, the orchestrator builds a
`PermissionRequest` for each required capability (`action` + optional `toolId`,
with `agentId` / `projectId` / `environment` filled in) and evaluates it.
Denied → the underlying operation never executes, the task fails with a
`PermissionDeniedError`, and a `permission_decision` audit event records the
denial. Executors receive a `PermissionGuard` for mid-run tool checks. Grants
should be as narrow as possible, with explicit `deny` for high-risk
combinations (e.g. `deploy` in `production`).

## 7. Context isolation

Project context is isolated by default. A task is permanently bound to the first
project it is stored under; rebinding throws. Agent context is stored per
`(project, agent)` pair. No API returns context across project boundaries.

## 8. Model & tool provider layer

`ModelProvider` (`{ id, generate(request) }`) and `ToolProvider` are
provider-neutral. The core never imports a vendor SDK.

**Doubles** (offline, deterministic):

- `EchoModelProvider` — echoes the last message.
- `InMemoryToolProvider` — dispatches to an explicit handler map; unknown tools
  throw. No shell, filesystem, or credential access.

**Anthropic adapter** (`adapters/models/anthropic-model-provider.ts`) — the only
module that knows the Anthropic SDK:

- **Config** — `loadAnthropicConfig(input?, env?)` resolves `apiKey` (required),
  `model`, `timeoutMs`, `maxTokens`, `maxRetries` from an explicit object → env
  vars (`ANTHROPIC_*`) → defaults, throwing `ProviderConfigError` on missing or
  invalid values. `describe()` returns the resolved config **without the key**.
- **Transport seam** — a local `AnthropicTransport` interface. The real one
  lazily `import()`s `@anthropic-ai/sdk` on first use (clear
  `ProviderConfigError` if not installed); tests inject a stub and never load
  the SDK or hit the network.
- **Mapping** — Workforce `ModelRequest` → Anthropic params (system messages
  split into `system`, only `user`/`assistant` in `messages`, `max_tokens` from
  config) → SDK → adapter → `ModelResponse` (text blocks concatenated, `usage`
  mapped). Malformed replies raise `ProviderResponseError`.
- **Errors** — `mapAnthropicError` translates failures onto the
  provider-neutral hierarchy in `contracts/`: `ProviderAuthError` (401/403),
  `ProviderRateLimitError` (429, retryable), `ProviderTimeoutError` (retryable),
  `ProviderUnavailableError` (connection / 5xx, retryable),
  `ProviderRequestError` (400/422), else `ProviderError`. Every derived message
  is run through `redactSecrets` — the key never appears in an error.

**Registry** — `ModelProviderRegistry` (core) resolves providers by id
("anthropic", "openai", ...) from factories the wiring layer registers; it
imports nothing provider-specific. `anthropicFactory(config, options)` (adapter)
produces such a factory, so core still never imports the adapter. Future
providers plug in the same way with no core change.

**Audit** — `AuditedModelProvider` (core) wraps any `ModelProvider` and records
`model_provider_requested`, `model_execution_started`,
`model_execution_completed`, `model_execution_failed` with provider, model,
token usage and sizes, plus correlation ids read from `request.metadata`. It
never records keys or headers. Prompt/response **content is not logged unless
`logContent: true`** is explicitly set (then only a truncated preview).

## 9. Project adapters

`ProjectAdapter` gives controlled access to one real project through a fixed,
**declared** capability list. `BaseProjectAdapter` enforces a stable
`projectId`, a `describe()` derived from declared operations, and an `execute()`
that rejects any undeclared operation. Project source is never copied here.

## 10. Persistence architecture

- **Interface:** `contracts/persistence.ts` — `Repository<T>` and
  `PersistenceProvider` (one repository per collection: tasks, agents,
  approvals, handoffs, audit events).
- **Default:** `InMemoryRepository` — `Map`-backed, copy-on-read/write, pure.
- **Durable:** `JsonFilePersistence(dir)` — a directory of atomically-written
  JSON files; a new instance on the same directory resumes state.
- **Injection:** each core system takes its `Repository` in its constructor.
  Wiring picks in-memory or durable; core code is identical either way.
- **Not persisted:** `ContextSystem` (in-memory by design), and anything
  secret — persisted entities carry no credentials.
- **Limits:** single-process, single-writer, whole-file rewrite per mutation.

## 11. CI

`.github/workflows/ci.yml` runs on `push` to `main` and on every
`pull_request`, against Node 20 and 22: `npm ci` → `npm run typecheck` →
`npm run lint` → `npm run format:check` → `npm test` → `npm run build`. It
requires no secrets and no AI provider credentials.

## 12. Code quality tooling

ESLint 9 (flat config, `@eslint/js` + `typescript-eslint` **recommended,
syntactic only**, `eslint-config-prettier`) and Prettier 3 (`printWidth 80`,
double quotes, trailing commas, semicolons). Dev-only; runtime dependency count
stays zero. `tsc --noEmit` remains the type-correctness gate. See
[ADR-0003](adr/0003-code-quality-tooling.md).

## 13. Testing

`npm test` compiles with `tsc` and runs `node --test` over the compiled output
(94 tests). Coverage: agent registration/lookup/validation; task
creation/(in)valid transitions/retry; handoff validation; permission
denial/approval and every scope (agent, project, tool, environment, explicit
deny); approval lifecycle including request/await/approve/reject/expiry/resume;
orchestrator routing/blocking/failure/approval-gated/permission-denied;
persistence save/load/update/isolation and survival across reinitialization;
audit events including approval, permission, and model-execution decisions;
Anthropic adapter config/validation, request/response mapping, and every
failure class (auth, rate-limit, timeout, network, server, bad-request,
malformed-response) via a stub transport; secret redaction; the provider
registry; the audit decorator; and a check that `core/` and `contracts/` carry
no Anthropic dependency. Every test is deterministic and offline — **no real AI
API calls**.

## 14. Extension guidelines

See [extending.md](extending.md). Add capability behind its contract, grant
least privilege, add deterministic tests, keep `core` free of adapter imports.

## 15. Security & configuration notes (model provider)

- Credentials come only from the environment (or an explicit config object),
  never from source. `.env` is git-ignored; `.env.example` holds placeholders
  only.
- The API key is never logged, never put in an error message (defence-in-depth
  redaction on top of never interpolating it), and never written to the audit
  log or persistence.
- Deny-by-default permissions, project isolation, and audit logging are
  unchanged; a model call still happens inside an executor that the orchestrator
  has already permission-checked.

## 16. Deliberately out of scope through Phase 2B

General/autonomous agents and planning, unrestricted model/tool loops,
additional real providers (OpenAI/Google), a live end-to-end integration test,
network I/O outside the Anthropic adapter, asynchronous workers or queues,
multi-process persistence and file locking, an async `Repository` revision, real
authentication, retries/backoff at the orchestrator level, external logging or
telemetry infrastructure, and any real project integration.
