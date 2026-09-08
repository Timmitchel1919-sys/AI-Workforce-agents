# AI Workforce — Agents

Reliable foundation for an AI agent workforce: a declarative agent registry, a
deterministic task lifecycle, structured agent-to-agent handoffs, a minimal
deterministic orchestrator with **approval-gated execution** and
**permission enforcement at the dispatch boundary**, deny-by-default
permissions, human approval records, project-isolated context, a structured
audit log, and **durable persistence behind an interface** — all behind
**provider- and project-agnostic contracts**.

> **Status: Phase 7B complete.** **Firebase infrastructure** wired in as an
> adapter: `AsyncRepository<T>` + `FirestoreRepository` bridged to the
> synchronous core by `CachedRepository` (hydrate once, write through);
> `FirebaseOperatorDirectory` (verify ID token → `OperatorPrincipal`);
> `FirestoreEventPublisher`; `FirebaseObjectStore`; plus a dependency-free
> **HTTP API** (`api/`) over the two Control Plane services — Bearer auth,
> correlation-id passthrough, `errorKind` → status codes, never a stack trace.
> `firebase-admin` is an **optional, lazily-loaded peer dependency**; nothing in
> `core/` or `control/` imports it, and `npm test` stays fully offline (adapters
> tested against in-memory seam fakes). `firestore.rules` / `storage.rules` deny
> **all** direct client access — every UI read/write goes through the API.
> Earlier phases: the Control Plane backend (roles, per-command audit +
> correlation ids, typed errors), the operations dashboard, the Money Mind
> **Project Adapter**, multi-agent **workflow orchestration**, four General
> Agents.
>
> **UI-1 (foundation) complete:** a separate React + TypeScript + Vite app in
> [`ui/`](ui/) — routing for all nine views + 404, a central typed API client
> (`Authorization: Bearer`, `x-correlation-id`, normalized errors), the Firebase
> **Auth** boundary (`loading / authenticated / unauthenticated / error`), and
> TanStack Query wired at the root. The UI talks to the `api/` HTTP surface only;
> it never touches Firestore, the Admin SDK, `core/`, or `control/`. Placeholder
> pages only — no visual design (UI-2), no feature dashboards (later). No
> real-time push; no unrestricted autonomous planning.

## Stack

- **TypeScript** (strict) on **Node.js ≥ 20**, ESM (`NodeNext`)
- Tests: built-in `node:test` + `node:assert/strict` (329 deterministic, offline)
- Build: `tsc` only
- Persistence: `Repository<T>` interface with a JSON-file store; `AsyncRepository<T>`
  plus `FirestoreRepository`, bridged to sync by `CachedRepository`
  ([ADR-0002](docs/adr/0002-local-json-file-persistence.md),
  [ADR-0011](docs/adr/0011-firebase-infrastructure.md))
- Model providers: provider-neutral `ModelProvider` contract; Anthropic adapter
  with the SDK as an **optional peer dependency**
  ([ADR-0004](docs/adr/0004-model-provider-layer-anthropic.md))
- General Agents: `GeneralAgent` base + `RoutingAgentExecutor`; Research,
  Project Manager, Developer, QA
  ([ADR-0005](docs/adr/0005-general-agent-pattern.md))
- Tools: first-class `Tool` contract + `ToolRegistry` + `ToolExecutionEngine`
  ([ADR-0006](docs/adr/0006-tool-execution-framework.md))
- Workflows: a validated task-dependency graph scheduled through the
  `Orchestrator`, with retries, handoffs, approval pauses, and limits
  ([ADR-0007](docs/adr/0007-multi-agent-workflow-orchestration.md))
- Project adapters: `ProjectAdapter` contract + `ProjectRegistry` + the first
  real implementation, `MoneyMindProjectAdapter` — read-mostly,
  capability-declared, tool-gated
  ([ADR-0008](docs/adr/0008-money-mind-project-adapter.md))
- Control plane: `WorkforceQueryService` + `WorkforceCommandService` above core,
  operator roles, per-command audit + correlation ids, typed error kinds,
  dependency-free dashboard
  ([ADR-0009](docs/adr/0009-workforce-control-plane.md),
  [ADR-0010](docs/adr/0010-control-plane-backend.md))
- Firebase infrastructure: `adapters/firebase/` implements `AsyncRepository` /
  `OperatorDirectory` / `ControlEventPublisher` / `ObjectStore` behind an
  **optional, lazily-loaded `firebase-admin`**; `api/` is a dependency-free HTTP
  surface over the two services ([ADR-0011](docs/adr/0011-firebase-infrastructure.md),
  [docs/firebase.md](docs/firebase.md))
- Lint/format: ESLint 9 + Prettier 3, **dev-only**
  ([ADR-0003](docs/adr/0003-code-quality-tooling.md))
- **Zero runtime dependencies in core**

## Layout

| Path                                             | Purpose                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`contracts/`](contracts/)                       | Shared types, pure validators, agent execution boundary, `Repository` / persistence + research + tool + workflow / project-manager / developer / qa + **money-mind** contracts.                                                                                                                                    |
| [`core/`](core/)                                 | Registry (agents + projects), tasks, handoffs, permissions, approvals, context, audit, model registry, General Agent framework, Tool Execution Engine, Workflow Engine, orchestrator.                                                                                                                              |
| [`adapters/`](adapters/)                         | Provider/project contracts + reference implementations: Echo/Anthropic model, tool fakes, JSON persistence, **`projects/money-mind/`**, and **`firebase/`** (Firestore repo, Auth operator directory, event publisher, object store).                                                                              |
| [`agents/`](agents/)                             | Concrete General Agents: `research/`, `project-manager/`, `developer/`, `qa/`, plus shared text/JSON helpers.                                                                                                                                                                                                      |
| [`control/`](control/)                           | Control & Operations Layer: `services/` (query + command), operational stores, redaction, health, view derivation, `dashboard/` (pure render + self-contained HTML).                                                                                                                                               |
| [`api/`](api/)                                   | Composition root: `createControlPlaneApi` (dependency-free Node `http` handler over the two services) + `FirebaseRepositoryProvider` (hydrate-once Firestore-backed repositories).                                                                                                                                 |
| [`ui/`](ui/)                                     | **AI Workforce Control Center** — a separate React + TypeScript + Vite app. Consumes the `api/` HTTP surface only; never Firestore/Admin/core. Own `package.json`, `tsconfig`, lint/test. UI-1 = foundation (routing, API client, auth boundary, placeholder pages).                                               |
| [`tests/`](tests/)                               | Deterministic, offline tests (329): the above + **control-plane** / **control-plane-backend** / **control-dashboard**, and **cached-repository** / **firebase-adapters** / **http-api** (Firebase seam fakes + a loopback `http.Server`). The `ui/` app has its own 36 Vitest tests.                               |
| [`docs/`](docs/)                                 | [Architecture](docs/architecture.md), [Control Plane](docs/control-plane.md), [Firebase](docs/firebase.md), [Tools](docs/tools.md), [Workflows](docs/workflows.md), [Research Agent](docs/agents/research-agent.md), [Money Mind](docs/projects/money-mind.md), [extending](docs/extending.md), [ADRs](docs/adr/). |
| `firebase.json` · `.firebaserc` · `*.rules`      | Firestore/Storage config; rules **deny all** direct client access (Admin SDK only).                                                                                                                                                                                                                                |
| [`.github/workflows/`](.github/workflows/ci.yml) | CI: typecheck → lint → format → test → build on push/PR.                                                                                                                                                                                                                                                           |

## Commands

```bash
npm install         # dev dependencies only
npm run typecheck   # tsc --noEmit, strict
npm run lint        # eslint .
npm run format      # prettier --write .
npm run format:check
npm test            # compile + run node --test over dist/
npm run check       # typecheck + lint + format:check + test
npm run build       # emit dist/
```

## Core components at a glance

| Component                                            | Responsibility                                                                                                                   |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `AgentRegistry`                                      | Validate and store declarative agents; look up by capability / eligibility.                                                      |
| `TaskSystem`                                         | Own the deterministic task lifecycle; reject illegal transitions.                                                                |
| `HandoffSystem`                                      | Propose / accept / reject validated agent-to-agent handoffs.                                                                     |
| `Orchestrator`                                       | Validate → enforce permissions → gate on approval → dispatch → record. `resume` after a decision. No autonomy.                   |
| `PermissionSystem`                                   | Deny-by-default evaluation scoped by agent/project/tool/action/environment; enforced at dispatch.                                |
| `ApprovalSystem`                                     | Record human approvals: `requested → approved \| rejected \| expired`. Never auto-approves.                                      |
| `ContextSystem`                                      | Task / project / agent context, isolated per project.                                                                            |
| `AuditLog`                                           | Structured events to a pluggable sink; queryable; optionally persisted.                                                          |
| `Repository<T>` / `PersistenceProvider`              | The only persistence types the core knows. In-memory default, JSON-file durable adapter.                                         |
| `ModelProvider` / `ToolProvider` / `ProjectAdapter`  | Vendor- and project-neutral seams.                                                                                               |
| `GeneralAgent` / `AgentRun` / `RoutingAgentExecutor` | Reusable agent framework: linear pipeline, hard limits, structured failure, `agent_activity` audit, dispatch by id.              |
| `Tool` / `ToolRegistry` / `ToolExecutionEngine`      | The one secure tool pipeline: validate → eligibility → limits → permission → approval → execute → validate → audit.              |
| `WorkflowSystem` / `WorkflowEngine`                  | A validated, cycle-free task-dependency graph, scheduled through the `Orchestrator`; retries, handoffs, approval pauses, limits. |
| `ResearchAgent`                                      | Bounded source-grounded research → validated `ResearchResult` with evidence-based confidence.                                    |
| `ProjectManagerAgent`                                | Decomposes an objective into a dependency-ordered plan, or summarizes a completed workflow. Never dispatches a task itself.      |
| `DeveloperAgent`                                     | Implementation plan + _proposed_ changes only — no filesystem, shell, or repository access.                                      |
| `QaAgent`                                            | Pass / fail / blocked verdict with evidence; a `"pass"` without satisfied findings is structurally rejected.                     |
| `MoneyMindProjectAdapter`                            | The first real `ProjectAdapter`: eight declared, mostly read-only capabilities against an independent Money Mind checkout.       |

## Persistence

```ts
import {
  AgentRegistry,
  TaskSystem,
  ApprovalSystem,
  AuditLog,
} from "./core/index.js";
import { JsonFilePersistence } from "./adapters/index.js";

const store = new JsonFilePersistence("./.workforce");
const registry = new AgentRegistry(store.agents);
const tasks = new TaskSystem(store.tasks);
const approvals = new ApprovalSystem(store.approvals);
const audit = new AuditLog(undefined, store.auditEvents);
// A fresh process pointed at "./.workforce" resumes prior state.
```

Pass nothing to get the in-memory default. `.workforce/` is git-ignored.

## Model providers

The core depends only on the `ModelProvider` contract. Concrete providers are
adapters, resolved by id through `ModelProviderRegistry` and wrapped for audit.

```ts
import {
  AuditLog,
  AuditedModelProvider,
  ModelProviderRegistry,
} from "./core/index.js";
import { anthropicFactory } from "./adapters/index.js";

const audit = new AuditLog();
const providers = new ModelProviderRegistry();
providers.register("anthropic", anthropicFactory()); // reads ANTHROPIC_* from env

const model = new AuditedModelProvider(providers.resolve("anthropic"), audit);
const res = await model.generate({
  messages: [
    { role: "system", content: "Be brief." },
    { role: "user", content: "Say hi." },
  ],
  metadata: { taskId: "task_1" }, // optional correlation for audit events
});
```

Install the SDK where you use the Anthropic adapter (it is an optional peer
dependency): `npm install @anthropic-ai/sdk`.

### Environment variables

Copy [`.env.example`](.env.example) to `.env` (git-ignored) and fill in:

| Variable                | Required | Default                    |
| ----------------------- | -------- | -------------------------- |
| `ANTHROPIC_API_KEY`     | yes      | —                          |
| `ANTHROPIC_MODEL`       | no       | `claude-3-5-sonnet-latest` |
| `ANTHROPIC_TIMEOUT_MS`  | no       | `60000`                    |
| `ANTHROPIC_MAX_TOKENS`  | no       | `1024`                     |
| `ANTHROPIC_MAX_RETRIES` | no       | `2`                        |

The key is never logged, never included in an error message, and never written
to the audit log or persistence. See
[ADR-0004](docs/adr/0004-model-provider-layer-anthropic.md).

## Research Agent

The first reusable General Agent. It runs a **bounded, non-recursive** pipeline
— plan → search + fetch + evaluate sources → synthesize → deterministic
post-processing — and returns a validated `ResearchResult` (executive summary,
findings classified `fact`/`claim`/`assumption`/`inference`/`recommendation`,
evidence, sources with computed reliability, assumptions, limitations,
recommendations, and an evidence-based `confidence`). It goes through
`ModelProvider` and `ToolProvider` only — no vendor SDK — and every tool call is
permission-checked. Read-only research needs no approval; a research task that
also requests `write` / `deploy` / `external_communication` / `secret_access`
is approval-gated.

```ts
import {
  AgentRegistry,
  ApprovalSystem,
  AuditLog,
  ContextSystem,
  HandoffSystem,
  Orchestrator,
  PermissionSystem,
  RoutingAgentExecutor,
  TaskSystem,
} from "./core/index.js";
import {
  ResearchAgent,
  RESEARCH_AGENT_ID,
  makeResearchAgentDefinition,
  researchAgentGrants,
  researchApprovalPolicy,
} from "./agents/research/index.js";

const registry = new AgentRegistry();
registry.register(makeResearchAgentDefinition({ allowedProjects: ["proj-x"] }));

const audit = new AuditLog();
const permissions = new PermissionSystem(researchAgentGrants());
const context = new ContextSystem();

const router = new RoutingAgentExecutor();
router.register(
  RESEARCH_AGENT_ID,
  new ResearchAgent({ model, tools, permissions, context, audit }),
);

const orchestrator = new Orchestrator(
  registry,
  new TaskSystem(),
  new HandoffSystem(),
  audit,
  router,
  new ApprovalSystem(),
  { permissions, environment: "local", approvalPolicy: researchApprovalPolicy },
);

const task = await orchestrator.submit({
  type: "research",
  description: "Research the state of X",
  projectId: "proj-x",
  input: { objective: "...", question: "..." },
  requiredPermissions: [
    { action: "execute", toolId: "research.search" },
    { action: "read", toolId: "research.fetch" },
  ],
});
// task.output is a validated ResearchResult
```

Limits (`maxIterations` 3, `maxToolCalls` 8, `maxModelCalls` 4, `timeoutMs` 60000) are configurable per deployment. Full detail:
[docs/agents/research-agent.md](docs/agents/research-agent.md),
[ADR-0005](docs/adr/0005-general-agent-pattern.md).

## Tools

Every tool runs through one secure pipeline — an agent never invokes a tool,
`ToolProvider`, the permission system, or a credential directly.

```ts
import {
  AuditLog,
  PermissionSystem,
  ToolExecutionEngine,
  ToolRegistry,
  DEFAULT_TOOL_LIMITS,
} from "./core/index.js";
import { makeInMemoryTool } from "./adapters/index.js";

const audit = new AuditLog();
const registry = new ToolRegistry(audit);
registry.register(
  makeInMemoryTool(
    {
      id: "docs.summarise",
      name: "Summarise",
      description: "Summarise a document by id.",
      version: "1.0.0",
      capabilities: ["summarisation"],
      requiredPermission: { action: "read" },
      allowedAgents: ["documentation-agent"],
      allowedProjects: ["*"],
      allowedEnvironments: ["local", "test", "staging"],
      timeoutMs: 10_000,
      limits: { ...DEFAULT_TOOL_LIMITS },
      metadata: {},
    },
    async (input) => ({ summary: `…${JSON.stringify(input)}` }),
  ),
);

const engine = new ToolExecutionEngine({
  registry,
  permissions: new PermissionSystem(grants),
  audit,
});

const request = engine.createRequest({
  taskId: "task-1",
  agentId: "documentation-agent",
  projectId: "proj-x",
  toolId: "docs.summarise",
  input: { id: "doc-42" },
});
const result = await engine.execute(request);
// result.status: success | failure | timeout | denied | approval_required
```

Pipeline: validate request → resolve tool → agent/project/environment
eligibility → input-size + per-task/agent call limits → `PermissionSystem` →
approval (park with `approval_required`, `engine.resume(requestId)` after a
decision) → execute with timeout → output-size + output-schema → audit. Full
detail: [docs/tools.md](docs/tools.md),
[ADR-0006](docs/adr/0006-tool-execution-framework.md).

## Workflows

Several agents collaborate on one task through a validated, cycle-free
dependency graph — every step still goes through the `Orchestrator`, so
permissions, approval, and tool execution are unchanged.

```ts
import {
  AgentRegistry,
  ApprovalSystem,
  AuditLog,
  ContextSystem,
  HandoffSystem,
  Orchestrator,
  PermissionSystem,
  RoutingAgentExecutor,
  TaskSystem,
  ToolExecutionEngine,
  ToolRegistry,
  WorkflowEngine,
  WorkflowSystem,
} from "./core/index.js";
// ...register agents, wire the Orchestrator (as above), then:

const engine = new WorkflowEngine({
  registry,
  workflows: new WorkflowSystem(),
  orchestrator,
  handoffs,
  audit,
  permissions,
});

const workflow = await engine.planFromObjective({
  name: "Add API rate limiting",
  description: "Research, plan, and verify rate limiting for the widgets API",
  projectId: "widgets-service",
  participatingAgents: ["research-agent", "developer-agent", "qa-agent"],
  objective: "Add rate limiting to the widgets API",
  availableAgents: ["research-agent", "developer-agent", "qa-agent"],
});
// Project Manager decomposes -> Research -> Developer -> QA, each re-validated,
// handoffs proposed+accepted across agent boundaries, workflow.status === "completed"
```

A gated task pauses the whole workflow (`awaiting_approval`) until
`engine.resume(workflow.id)` is called after a human decision. Limits
(`maxTasks`, `maxAgentExecutions`, `maxRetries`, `maxHandoffs`, `maxToolCalls`,
`maxDurationMs`, `maxDelegationDepth`) and a retry policy are configurable per
workflow. Full detail: [docs/workflows.md](docs/workflows.md),
[ADR-0007](docs/adr/0007-multi-agent-workflow-orchestration.md).

## Money Mind

The first real `ProjectAdapter` — read-mostly, capability-declared, reached
only through the same secure `Tool` pipeline as any other tool:

```ts
import {
  MoneyMindProjectAdapter,
  InMemoryMoneyMindRepo,
  makeMoneyMindTools,
} from "./adapters/index.js";
// production wiring instead uses NodeMoneyMindRepo({ repoPath }), where
// repoPath comes from loadMoneyMindConfig() / MONEY_MIND_REPO_PATH

const adapter = new MoneyMindProjectAdapter({
  repo: new InMemoryMoneyMindRepo(),
});
const tools = makeMoneyMindTools(adapter); // 8 Tools — register with a ToolRegistry
// Research: money-mind.read-docs (search) + money-mind.read-file (fetch)
// Developer / QA: money-mind.inspect / .read-file / .read-config / .test
// Project Manager: money-mind.status / .read-project
```

Every capability but `RUN_TESTS` (`money-mind.test`, always approval-gated,
one allowlisted npm script, never a raw command) is read-only. No
write/commit/push/deploy capability exists. Full detail:
[docs/projects/money-mind.md](docs/projects/money-mind.md),
[ADR-0008](docs/adr/0008-money-mind-project-adapter.md).

## Control & operations layer

`UI → control services → core → contracts`. The operator gets visibility and
controlled intervention; the control plane is **not** a second orchestrator and
never bypasses permission / approval / audit.

```ts
import {
  WorkforceQueryService,
  WorkforceCommandService,
  AgentOperationalStore,
  WorkflowControlStore,
  buildDashboardHtml,
  type ControlPlaneContext,
} from "./control/index.js";

const ctx: ControlPlaneContext = {
  agents,
  tasks,
  workflows,
  approvals,
  permissions,
  tools,
  projects,
  audit,
  agentOps: new AgentOperationalStore(),
  workflowControl: new WorkflowControlStore(),
  orchestrator,
  workflowEngine,
};
// wire the gate so a disabled agent gets no new tasks:
//   new Orchestrator(..., { agentGate: ctx.agentOps })

const query = new WorkforceQueryService(ctx);
const command = new WorkforceCommandService(ctx);

const principal = {
  id: "sam",
  role: "operator",
  allowedProjects: "*",
} as const;
const snapshot = await query.getDashboardSnapshot(principal);
const html = buildDashboardHtml(snapshot, {
  commandEndpoint: "/api/control/command",
});

const result = await command.approve(
  principal,
  { approvalId },
  { correlationId: "req-123" }, // optional; minted if omitted
);
// {
//   command, outcome: "executed" | "denied" | "rejected", ok,
//   errorKind?: "invalid_request" | "forbidden" | "not_found" | "invalid_state"
//             | "approval_failure" | ...,
//   reason, correlationId, auditEventId, timestamp, details
// }
```

Roles: `viewer` (view), `operator` (+ approve/reject/cancel/retry/pause/resume),
`admin` (+ enable/disable agent). Every command — including denied and rejected
— emits a `control_command` audit event carrying the correlation id; every
non-`executed` result carries an `errorKind`. System health is
`healthy | degraded | unavailable | unknown` (an unmeasured component is
`unknown`, never silently `healthy`).

The contract ports (`OperatorDirectory`, `ControlEventPublisher`,
`ControlRepository<T>`, `ObjectStore`) are implemented as Firebase adapters in
Phase 7B — see below. The Phase 7 dashboard is one dependency-free HTML document
(nine views); [`control/dashboard/README.md`](control/dashboard/README.md) shows
its seam. Full detail: [docs/control-plane.md](docs/control-plane.md),
[ADR-0009](docs/adr/0009-workforce-control-plane.md),
[ADR-0010](docs/adr/0010-control-plane-backend.md).

## Firebase infrastructure

Firebase is an **infrastructure adapter behind provider-neutral ports** — never
a dependency of `core/` or `control/`.

```
UI → api/ (HTTP) → control/ services → core/ → contracts/ ports
                                              └→ adapters/firebase/ → Firestore · Auth · Storage
```

- `adapters/firebase/` implements `AsyncRepository<T>` (`FirestoreRepository`),
  `OperatorDirectory` (`FirebaseOperatorDirectory` — verify ID token →
  `role`/`allowedProjects` claims → `OperatorPrincipal`), `ControlEventPublisher`
  (`FirestoreEventPublisher`), and `ObjectStore` (`FirebaseObjectStore` — signed
  URLs only). It is the **only** `firebase-admin` consumer; the SDK is an
  optional peer dependency, loaded with a dynamic `import()`.
- `CachedRepository` (`core/persistence/`) bridges the async Firestore repo to
  the synchronous `Repository<T>` every core system uses: hydrate once, serve
  reads from memory, write through on a queue. Drops into the existing
  constructors unchanged.
- `api/createControlPlaneApi({ query, command, operatorDirectory })` is a
  dependency-free Node `http` handler: `Authorization: Bearer <Firebase ID
token>` on every route but `/api/health`, `x-correlation-id` in and out,
  `errorKind` / `WorkforceError` → status codes, `{ "error": { "message" } }`
  bodies (never a stack trace).
- `firestore.rules` / `storage.rules` **deny all** direct client access — the
  Admin SDK bypasses rules, so the Control Plane keeps full access while no
  browser can touch Firestore/Storage. Every UI operation goes through the API.
- `npm test` stays fully offline: the adapters are unit-tested against
  hand-written in-memory seam fakes; `firebase-admin` is never imported by a
  test. Local end-to-end runs use the Firebase emulator (`firebase.json`).

Wiring example and env vars: [docs/firebase.md](docs/firebase.md),
[ADR-0011](docs/adr/0011-firebase-infrastructure.md). **No frontend yet**
(Phase 7C).

## Extending

Read [docs/extending.md](docs/extending.md). Never let `core/` import an adapter
or a vendor SDK; put every external capability (providers, tools, projects,
persistence) behind a contract; keep new actions deny-by-default; add
deterministic tests; never commit a secret.

## Security notes

- Deny-by-default permissions, **enforced before dispatch**; least privilege
  declared per agent and per task.
- Human approval is a recorded, first-class gate; the orchestrator never
  auto-approves.
- Project context does not cross project boundaries — the Research Agent reads
  context only for its task's project.
- No secrets in the repo or in persistence. Providers read credentials from the
  environment at call time; the Anthropic adapter redacts the key from every
  error message and never logs it.
- The control plane redacts every operator-visible field, enforces role +
  project authorization on every query and command (the UI is not a security
  boundary), and audits every command. It never touches a database, filesystem,
  shell, or credential.
- Firebase is adapter-only: `firebase-admin` is a lazily-loaded optional peer
  dependency imported by `adapters/firebase/` alone; `firestore.rules` /
  `storage.rules` deny all direct client access; service-account keys come from
  a gitignored `.env` path and are never committed; the HTTP API sends no stack
  traces and hands the UI signed URLs, never storage credentials.
- General Agents get least-privilege grants (the Research Agent: two read-only
  tools; `write` / `deploy` / `secret_access` / `external_communication`
  denied), run bounded (no recursion, hard iteration/tool/model/time limits),
  and fail closed with a structured error.
- Every tool call goes through the `ToolExecutionEngine`: deny-by-default
  agent/project/environment eligibility, `PermissionSystem`, opt-in per-tool
  approval, per-task/agent call limits, input/output size limits, and a full
  `tool_execution` audit trail. A denied or unapproved tool's handler never
  runs. Tool output is never written to the audit log. No unrestricted shell,
  filesystem, deployment, or credential-access tools.
- A workflow's task graph is rejected outright — no task runs — if it has an
  unknown dependency or a cycle. Every agent assignment (hand-authored or
  Project-Manager-recommended) is independently re-validated; a recommendation
  is never trusted blindly. A gated task pauses the whole workflow until a
  human decision arrives; `resume` on a workflow that isn't waiting throws.
- `.env` is git-ignored; `.env.example` contains placeholders only.
- CI runs without any secret or AI credential.
- Money Mind access is scoped to `allowedProjects: ["money-mind"]` on every
  tool (never `"*"`); file reads reject traversal, absolute paths, and
  sensitive filenames (`.env*`, `.git`, credentials, keys); `RUN_TESTS`
  accepts only a closed enum of npm script names, re-confirmed against the
  target's own `package.json` before anything is spawned, and is always
  approval-gated. No Money Mind source is copied into this repository —
  every test uses a synthetic, hand-written fixture.
