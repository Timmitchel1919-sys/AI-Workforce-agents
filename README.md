# AI Workforce — Agents

Reliable foundation for an AI agent workforce: a declarative agent registry, a
deterministic task lifecycle, structured agent-to-agent handoffs, a minimal
deterministic orchestrator with **approval-gated execution** and
**permission enforcement at the dispatch boundary**, deny-by-default
permissions, human approval records, project-isolated context, a structured
audit log, and **durable persistence behind an interface** — all behind
**provider- and project-agnostic contracts**.

> **Status: Phase 4 complete.** A secure, standardised **Tool & Execution
> Framework** — one `ToolExecutionEngine` every agent must use to run a tool
> (validate → eligibility → limits → permissions → approval → execute →
> validate result → audit). The Research Agent is migrated onto it and no longer
> has its own tool-execution logic. No autonomous planning, no other agents yet.
> Money Mind will be the first real project integration in a later phase; its
> source is never copied here.

## Stack

- **TypeScript** (strict) on **Node.js ≥ 20**, ESM (`NodeNext`)
- Tests: built-in `node:test` + `node:assert/strict` (160 deterministic, offline)
- Build: `tsc` only
- Persistence: `Repository<T>` interface; JSON-file store as the first
  implementation ([ADR-0002](docs/adr/0002-local-json-file-persistence.md))
- Model providers: provider-neutral `ModelProvider` contract; Anthropic adapter
  with the SDK as an **optional peer dependency**
  ([ADR-0004](docs/adr/0004-model-provider-layer-anthropic.md))
- General Agents: `GeneralAgent` base + `RoutingAgentExecutor`; the Research
  Agent as the first ([ADR-0005](docs/adr/0005-general-agent-pattern.md))
- Tools: first-class `Tool` contract + `ToolRegistry` + `ToolExecutionEngine`
  ([ADR-0006](docs/adr/0006-tool-execution-framework.md))
- Lint/format: ESLint 9 + Prettier 3, **dev-only**
  ([ADR-0003](docs/adr/0003-code-quality-tooling.md))
- **Zero runtime dependencies in core**

## Layout

| Path                                             | Purpose                                                                                                                                                                 |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`contracts/`](contracts/)                       | Shared types, pure validators, agent execution boundary, `Repository` / persistence + research + **tool** contracts.                                                    |
| [`core/`](core/)                                 | Registry, tasks, handoffs, permissions, approvals, context, audit, model registry, **General Agent framework**, **Tool Execution Engine**, orchestrator.                |
| [`adapters/`](adapters/)                         | Provider/project contracts + offline reference implementations (Echo/Anthropic model, tool provider + `Tool` fakes, JSON persistence).                                  |
| [`agents/`](agents/)                             | Concrete General Agents. **`agents/research/`** — the Research Agent.                                                                                                   |
| [`tests/`](tests/)                               | Deterministic, offline tests (160): foundation, persistence, approval, permissions, model provider, research agent, tool framework.                                     |
| [`docs/`](docs/)                                 | [Architecture](docs/architecture.md), [Tools](docs/tools.md), [Research Agent](docs/agents/research-agent.md), [extension guide](docs/extending.md), [ADRs](docs/adr/). |
| [`.github/workflows/`](.github/workflows/ci.yml) | CI: typecheck → lint → format → test → build on push/PR.                                                                                                                |

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

| Component                                            | Responsibility                                                                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `AgentRegistry`                                      | Validate and store declarative agents; look up by capability / eligibility.                                         |
| `TaskSystem`                                         | Own the deterministic task lifecycle; reject illegal transitions.                                                   |
| `HandoffSystem`                                      | Propose / accept / reject validated agent-to-agent handoffs.                                                        |
| `Orchestrator`                                       | Validate → enforce permissions → gate on approval → dispatch → record. `resume` after a decision. No autonomy.      |
| `PermissionSystem`                                   | Deny-by-default evaluation scoped by agent/project/tool/action/environment; enforced at dispatch.                   |
| `ApprovalSystem`                                     | Record human approvals: `requested → approved \| rejected \| expired`. Never auto-approves.                         |
| `ContextSystem`                                      | Task / project / agent context, isolated per project.                                                               |
| `AuditLog`                                           | Structured events to a pluggable sink; queryable; optionally persisted.                                             |
| `Repository<T>` / `PersistenceProvider`              | The only persistence types the core knows. In-memory default, JSON-file durable adapter.                            |
| `ModelProvider` / `ToolProvider` / `ProjectAdapter`  | Vendor- and project-neutral seams.                                                                                  |
| `GeneralAgent` / `AgentRun` / `RoutingAgentExecutor` | Reusable agent framework: linear pipeline, hard limits, structured failure, `agent_activity` audit, dispatch by id. |
| `Tool` / `ToolRegistry` / `ToolExecutionEngine`      | The one secure tool pipeline: validate → eligibility → limits → permission → approval → execute → validate → audit. |
| `ResearchAgent`                                      | First General Agent: bounded source-grounded research → validated `ResearchResult` with evidence-based confidence.  |

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
- `.env` is git-ignored; `.env.example` contains placeholders only.
- CI runs without any secret or AI credential.
