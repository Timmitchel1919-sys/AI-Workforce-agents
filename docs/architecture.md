# AI Workforce — Architecture

## 1. Overview

The AI Workforce is a **modular monolith** written in **TypeScript** and run on
**Node.js**. It provides the reliable primitives an AI agent workforce needs —
an agent registry, a deterministic task lifecycle, structured handoffs, a
minimal orchestrator, deny-by-default permissions enforced at the dispatch
boundary, human approval gates, project-isolated context, a structured audit
log, and durable persistence behind an interface — all behind **provider- and
project-agnostic contracts**.

As of Phase 6 there is a real model-provider adapter (Anthropic), four General
Agents (Research, Project Manager, Developer, QA), a secure Tool & Execution
Framework, a controlled multi-agent **Workflow** layer that coordinates them
through a validated task-dependency graph, and the first real project
integration — a read-mostly **Project Adapter** reaching the independent
Money Mind repository — but still no unrestricted autonomous planning and no
write/deploy capability against any real project. Every external capability
(a model provider, an external tool, a real project such as Money Mind, a
database) enters only through an interface in
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
  index.ts                  Types + pure validators + agent execution boundary. No runtime deps.
  persistence.ts            Repository<T> + PersistenceProvider interfaces.
  research.ts                ResearchTask / ResearchResult + validators.
  tools.ts                  Tool contract, ToolExecutionRequest/Result, limits, policy + validators.
  workflow.ts                Workflow / task-graph contracts + cycle detection + validators.
  project-manager.ts         ProjectManagerTask / ProjectManagerDecision + validators.
  developer.ts                DeveloperTask / DeveloperResult + validators.
  qa.ts                      QATask / QAResult + validators (structural "no self-approval" guarantee).
  money-mind.ts               Money Mind capability enum, per-operation I/O shapes + validators.
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
  agents/general-agent      GeneralAgent base + AgentRun (limits, audit, structured failure).
  agents/routing-agent-executor  RoutingAgentExecutor — dispatch by agent.id.
  tools/tool-policy         Pure deny-by-default eligibility + approval predicates.
  tools/tool-registry       ToolRegistry — validate, freeze, controlled update, eligibility.
  tools/tool-execution-engine  ToolExecutionEngine — the one secure tool pipeline.
  orchestrator/orchestrator  Orchestrator — validate → permit → gate → dispatch → record.
  workflows/workflow-graph   Pure: cycle-free readiness, agent assignment validation, retry policy.
  workflows/workflow-system  WorkflowSystem — deterministic workflow lifecycle (mirrors TaskSystem).
  workflows/workflow-engine  WorkflowEngine — schedules a task graph through the Orchestrator.
  index.ts                  Barrel export for the whole core.
adapters/
  models/model-provider     ModelProvider contract + EchoModelProvider double.
  models/anthropic-model-provider  AnthropicModelProvider + config + transport seam + error mapping.
  tools/tool-provider       ToolProvider contract + InMemoryToolProvider double (low-level shape).
  tools/static-research-tools  StaticResearchToolProvider — offline research.search / research.fetch.
  tools/mock-tools          makeInMemoryTool + mockResearchTools — deterministic Tool fakes.
  projects/project-adapter  ProjectAdapter contract + BaseProjectAdapter helper.
  projects/money-mind/      MoneyMindProjectAdapter — the first real ProjectAdapter (read-mostly).
  persistence/json-file-persistence  JsonFileRepository / JsonFilePersistence (durable, node:fs).
  index.ts                  Barrel export for adapters.
agents/
  shared/text-utils          extractJsonObject / toStringArray / truncate / dedupe — shared by PM/Dev/QA.
  research/                  ResearchAgent (extends GeneralAgent) — calls tools via the engine.
  project-manager/           ProjectManagerAgent — decompose an objective, or summarize a workflow.
  developer/                 DeveloperAgent — implementation plan + proposed changes only.
  qa/                        QaAgent — pass/fail/blocked verdict; cannot self-approve without evidence.
tests/
  foundation | persistence | approval-execution | permission-enforcement
  anthropic-provider | model-provider-layer | research-agent | tool-framework
  workflow-engine | workflow-agents | workflow-demo
  money-mind-adapter | money-mind-agents | money-mind-demo | money-mind-fs-repo  (254 tests total)
docs/                       This documentation + ADRs.
.env.example                Placeholder environment configuration (never a real .env).
.github/workflows/ci.yml    Continuous integration.
```

Dependency direction is one-way: `adapters → contracts`, `core → contracts`,
and `agents → core → contracts` (`agents` also uses `contracts` directly).
`core` never imports from `adapters` or `agents`. The orchestrator, every core
system's `Repository`, the `AgentExecutor`, the `ApprovalPolicy`, the
`PermissionSystem`, each General Agent's `ModelProvider` / `ToolProvider` /
`PermissionSystem` / `ContextSystem`, and the `WorkflowEngine`'s `Orchestrator`
are all supplied by constructor injection. `WorkflowEngine` depends only on
`core` types (`AgentRegistry`, `WorkflowSystem`, `Orchestrator`, `HandoffSystem`,
`AuditLog`, `PermissionSystem`, optionally `ToolRegistry`) — it never imports a
concrete agent.

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
`model_execution_failed`, `agent_activity` (General Agent phase events, with a
`data.kind` discriminator), `tool_registered`, `tool_execution` (tool pipeline
phase events, with a `data.phase` discriminator — covers every Money Mind
operation, since each is invoked as a `Tool`), `workflow_event` (workflow
lifecycle events, with a `data.kind` discriminator — see §9c),
`project_adapter_event` (`data.kind: "adapter_initialized"`, emitted once by
the wiring layer right after constructing a `ProjectAdapter`).

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

**Money Mind** (`adapters/projects/money-mind/`) is the first real
implementation — a read-mostly integration with the independent Money Mind
repository. Full detail in [projects/money-mind.md](projects/money-mind.md);
rationale in [ADR-0008](adr/0008-money-mind-project-adapter.md). In short:

- `MoneyMindProjectAdapter` declares eight capabilities (`READ_PROJECT`,
  `READ_STATUS`, `READ_TEST_RESULTS`, `READ_CONFIGURATION`, `READ_FILE`,
  `RUN_TESTS`, `INSPECT_STRUCTURE`, `READ_DOCUMENTATION`) — all read-only
  except `RUN_TESTS`, which runs one allowlisted, existing npm script and
  never touches tracked source. Six further capabilities
  (create/modify/branch/commit/PR/deploy) are named but have **no code path**
  this phase.
- It depends only on a narrow `MoneyMindRepoPort` (`exists` / `readTextFile` /
  `listDirectory` / `hasScript` / `runScript`), implemented by
  `InMemoryMoneyMindRepo` (synthetic fixture — every test, the demonstration
  workflow) and `NodeMoneyMindRepo` (real `node:fs` + `child_process`; the
  only module allowed to touch either for Money Mind; never used in a test).
- Every capability is exposed as a `Tool` (`money-mind-tools.ts`), scoped to
  `allowedProjects: ["money-mind"]` and to specific agent ids per a
  declarative profile (`money-mind-profile.ts`) — agents never call the
  adapter directly.
- File access goes through `resolveSafeRelativePath` (traversal + absolute +
  sensitive-filename rejection, string-level, re-checked at the OS level by
  `NodeMoneyMindRepo`). Command execution is a closed `MoneyMindScript` enum,
  re-confirmed against the target's own `package.json` before anything is
  spawned, and — on Windows — invoked via `cmd.exe` as the executable with a
  plain argv array, never `shell: true` plus string concatenation.

## 9a. General Agents

A General Agent is a declarative `Agent` (registered) plus an `AgentExecutor`
the orchestrator dispatches to. `AgentExecutor` and `PermissionGuard` are
contracts; `RoutingAgentExecutor` (core) fans the orchestrator's single
executor out to per-agent executors by `agent.id`, so many agents coexist with
no orchestrator change.

`GeneralAgent<TInput, TOutput>` (core) owns the invariant parts:

- a **linear, non-recursive** pipeline — `validateInput → run → validateOutput`
- hard `AgentLimits` — `maxIterations` / `maxToolCalls` / `maxModelCalls` /
  `timeoutMs` (injectable clock; deterministic timeout)
- one structured failure — `AgentExecutionError` with a machine `reason`
  (`invalid_task`, `model_unavailable`, `model_failure`, `tool_unavailable`,
  `tool_failure`, `permission_denied`, `timeout`, `limit_exceeded`,
  `invalid_result`, `internal_error`); agents fail closed, never returning a
  partial or unstructured result
- `agent_activity` audit events at each phase (`AgentRun.activity(kind, data)`)

Subclasses implement only the domain steps and call
`AgentRun.countToolCall` / `.countModelCall` / `.nextIteration` /
`.checkDeadline` before each metered step. A General Agent depends only on
`ModelProvider`, `ToolProvider`, `PermissionSystem`, `ContextSystem`,
`AuditLog` — never a vendor SDK or a concrete adapter (a test enforces this for
`agents/`).

**Research Agent** (`agents/research/`) is the first: it validates a
`ResearchTask`, loads context for its project only, plans (model call),
searches + fetches + evaluates sources (permission-checked tool calls),
synthesizes (model call), then deterministically post-processes (drop
uncollected citations, downgrade unsupported facts, compute confidence) and
returns a validated `ResearchResult`. Source `reliability` and `confidence` are
computed from evidence, not model wording. `researchAgentGrants()` is
least-privilege (allow the two read-only tools, deny write/deploy/secrets/
comms). `researchApprovalPolicy` gates a research task only when it also
declares a state-changing/outbound requirement. Full detail in
[agents/research-agent.md](agents/research-agent.md); rationale in
[ADR-0005](adr/0005-general-agent-pattern.md).

## 9b. Tool & Execution Framework

One secure pipeline every agent uses to run a tool — an agent never invokes a
tool, `ToolProvider`, the permission system, or a credential directly.

- **`Tool` contract** (`contracts/tools.ts`) — a `ToolDefinition` carries its
  own policy: `requiredPermission`, `approvalPolicy`, `allowedAgents` /
  `allowedProjects` / `allowedEnvironments` (deny-by-default; `"*"` = any),
  `timeoutMs`, `limits` (calls per task/agent, per-call duration, input/output
  bytes), optional input/output schema validators. `Tool = ToolDefinition &
{ execute(input, ctx) }`; the handler's `ToolExecutionContext` has no
  permission system, no credentials, no shell, no filesystem.
- **`ToolRegistry`** — validates on registration, **freezes** the definition,
  allows change only via `update(id, changes)` (re-validates), answers
  eligibility, and `describe(id)` exposes metadata without the handler. Emits
  `tool_registered`.
- **`ToolExecutionEngine`** — `execute(request)` runs a fixed, deterministic
  sequence: validate request → resolve tool → agent/project/environment
  eligibility → input-size + per-task/agent call limits →
  `PermissionSystem.evaluate` (+ `permission_decision` audit) → approval policy
  (park with `approval_required`, `resume(requestId)` after a human decision) →
  run handler with timeout → output-size + output-schema → `ToolExecutionResult`
  (`success` | `failure` | `timeout` | `denied` | `approval_required`). Every
  step is a `tool_execution` audit event with a `data.phase`. Tool output is
  never written to the audit log.

The tool-level approval gate is **orthogonal** to the orchestrator's task-level
`ApprovalPolicy` — both apply. Full detail in [tools.md](tools.md); rationale in
[ADR-0006](adr/0006-tool-execution-framework.md).

## 9c. Multi-agent workflow orchestration

A `Workflow` (`contracts/workflow.ts`) is a declarative task graph — nodes
(`WorkflowTaskSpec`) with `dependsOn` edges, scoped to one project — that the
`WorkflowEngine` (`core/workflows/`) schedules **through the existing
`Orchestrator`**, task by task, so every Phase 2A–4 control (permissions,
approval, tool execution) applies unchanged.

- **Graph validation** — `findCycle` (pure, contract-level) rejects unknown
  dependencies, self-dependencies, and any cycle _before_ a `Workflow` is even
  created; `WorkflowSystem.create` also rejects a graph over `limits.maxTasks`.
  Nothing runs on an invalid graph.
- **Scheduling** — `computeReadySpecs` picks specs whose dependencies have all
  completed; `assignAgent` independently re-validates every assignment
  (registered, a declared participant, eligible, holds the capability, tool
  access authorized) — a Project-Manager-recommended agent is never trusted
  blindly, same as a hand-authored one.
- **Handoffs** — cross-agent dependency edges get a real, validated
  `HandoffSystem` propose→accept pair, not free text.
- **Failure & retry** — `extractFailureReason` reads the `[agentId:reason]`
  convention every `AgentExecutionError` already carries; `shouldRetry` caps
  retries per task and never retries a permission/validation failure;
  `failureBehavior: "abort" | "continue"` controls whether one failure stops
  the whole workflow or only its dependents.
- **Approval** — a gated task parks its record `awaiting_approval`; if nothing
  else is actionable the whole workflow pauses there until
  `engine.resume(workflowId)` is called after a human decision — the same
  unbypassable gate as a standalone task.
- **Limits** — `maxTasks`, `maxAgentExecutions`, `maxRetries`, `maxHandoffs`,
  `maxToolCalls` (aggregated from each General Agent's own reported counters),
  `maxDurationMs` (injectable clock), and `maxDelegationDepth` (bounding
  `planFromObjective`, so nothing can recursively re-plan itself).
- **Project Manager, Developer, QA** — three more `GeneralAgent`s, the same
  pattern as Research (§9a): Project Manager only _proposes_ a decomposition
  (`ProjectManagerDecision`) or a final summary and holds no tool access;
  Developer only _proposes_ changes (`DeveloperResult`), with no filesystem or
  shell dependency to call; QA's `"pass"` verdict is structurally rejected by
  `validateQAResult` unless every finding is satisfied — it cannot approve its
  own work without evidence, even if its own logic were bypassed.

One new audit type, `workflow_event` (`data.kind` discriminator) — same
pattern as `agent_activity`/`tool_execution`, not a literal type per lifecycle
transition. Full detail in [workflows.md](workflows.md); rationale in
[ADR-0007](adr/0007-multi-agent-workflow-orchestration.md).

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
(**254 tests**). Coverage: the Phase 1–5 surface (registry, task lifecycle,
handoffs, permissions + every scope, approval lifecycle + resume, orchestrator
routing, persistence + survival across reinit, audit, the Anthropic adapter and
its failure classes, the model provider registry + audit decorator, the
Research Agent workflow / limits / context isolation / failure modes, the
Tool & Execution Framework's registry/request/permission/approval/execution/
limit/security matrix, and multi-agent workflow orchestration — creation/
validation/circular-dependency-rejection, task ordering, agent assignment,
retry, failure behaviour, approval, every execution limit, the Project
Manager/Developer/QA agents, handoffs, and one full deterministic
demonstration); plus **the Money Mind project adapter**:

- **Unit** (`money-mind-adapter.test.ts`, all against the in-memory fixture):
  adapter identity + every declared capability; access control (authorized/
  unauthorized project, agent, capability); file-path security (allowed path,
  not-found, traversal, absolute-outside, sensitive-filename, end-to-end
  denial via the tool engine); the command allowlist (allowed + existing,
  allowed-but-undefined, unknown/unlisted, shell-injection-shaped strings,
  every allowlisted name is alphabetic-only, end-to-end through the engine);
  permissions (read allowed, write/deploy denied, deny-by-default for an
  ungranted agent); approval (`RUN_TESTS` always gated, reads never are,
  rejected approval spawns nothing, approved approval actually runs);
  context isolation; and the audit trail (success, denial, failure, a
  rejected command traced distinctly).
- **Integration** (`money-mind-agents.test.ts`): the real, unmodified
  `ResearchAgent` pipeline reaching Money Mind through
  `money-mind.read-docs` / `money-mind.read-file` and producing a validated,
  source-grounded `ResearchResult` (plus a denied-without-grant case); the
  Project Manager, Developer, and QA agents' granted tool eligibility proven
  directly against the `ToolExecutionEngine`.
- **Demonstration** (`money-mind-demo.test.ts`): one full, deterministic run
  of Project Manager → Research (via Money Mind) → QA → Project Manager →
  Completed, answering "what is complete, what tests exist, and what should
  be worked on next" — confirmed never to have called `runScript`.
- **Real filesystem backend** (`money-mind-fs-repo.test.ts`, isolated from
  the rest — see §22 of the Phase 6 brief): `NodeMoneyMindRepo` against a
  throwaway temp directory (never a real Money Mind checkout) — real file
  reads, real directory listing, real traversal/sensitive-path rejection at
  the OS level, real `npm run <script>` execution and exit code, and a
  missing-repository-path failing safely rather than crashing.

Every test is deterministic and offline — **no real AI API calls, no real
external services, no real Money Mind repository**.

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

## 16. Deliberately out of scope through Phase 6

Unrestricted autonomous planning or agent-triggered recursion; the remaining
six General Agents (Data Analyst, Security, Finance, Business, Design,
Documentation); a real "apply this change" capability for the Developer Agent;
dynamic wiring of one workflow task's live output into a successor's input;
an automatic "Project Manager re-plans after a mid-workflow failure" loop;
additional real model providers (OpenAI/Google); a live end-to-end
integration test; network I/O outside the Anthropic adapter; source
deduplication and retry inside the Research Agent; per-session tool budgets
across tasks; persisted/resumable in-flight scheduling across a process
restart mid-loop; asynchronous workers or queues; multi-process persistence
and file locking; an async `Repository` revision; real authentication;
retries/backoff at the orchestrator level; external logging or telemetry
infrastructure; **any write, commit, branch, pull-request, or deploy
capability against Money Mind** (documented in
[projects/money-mind.md](projects/money-mind.md) §15, no code path exists);
and project adapters for AIMS, Mastery, or Tripod Product (Money Mind is the
only real project integration this phase — see
[extending.md](extending.md) §"Adding a project adapter" for the now-proven
recipe).
