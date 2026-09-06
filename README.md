# AI Workforce — Agents

Reliable foundation for an AI agent workforce: a declarative agent registry, a
deterministic task lifecycle, structured agent-to-agent handoffs, a minimal
deterministic orchestrator with **approval-gated execution** and
**permission enforcement at the dispatch boundary**, deny-by-default
permissions, human approval records, project-isolated context, a structured
audit log, and **durable persistence behind an interface** — all behind
**provider- and project-agnostic contracts**.

> **Status: Phase 2B complete.** First real model provider (Anthropic) behind
> the provider-neutral contract. No autonomous/general agents, no unrestricted
> model loops. Money Mind will be the first real project integration in a later
> phase; its source is never copied here.

## Stack

- **TypeScript** (strict) on **Node.js ≥ 20**, ESM (`NodeNext`)
- Tests: built-in `node:test` + `node:assert/strict` (94 deterministic, offline)
- Build: `tsc` only
- Persistence: `Repository<T>` interface; JSON-file store as the first
  implementation ([ADR-0002](docs/adr/0002-local-json-file-persistence.md))
- Model providers: provider-neutral `ModelProvider` contract; Anthropic adapter
  with the SDK as an **optional peer dependency**
  ([ADR-0004](docs/adr/0004-model-provider-layer-anthropic.md))
- Lint/format: ESLint 9 + Prettier 3, **dev-only**
  ([ADR-0003](docs/adr/0003-code-quality-tooling.md))
- **Zero runtime dependencies in core**

## Layout

| Path                                             | Purpose                                                                                                 |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| [`contracts/`](contracts/)                       | Shared types, pure validators, and the `Repository` / `PersistenceProvider` interfaces.                 |
| [`core/`](core/)                                 | Registry, tasks, handoffs, permissions, approvals, context, audit, orchestrator, in-memory persistence. |
| [`adapters/`](adapters/)                         | Provider/project contracts + offline reference implementations, and the JSON-file persistence store.    |
| [`tests/`](tests/)                               | Deterministic, offline tests: foundation, persistence, approval execution, permission enforcement.      |
| [`docs/`](docs/)                                 | [Architecture](docs/architecture.md), [extension guide](docs/extending.md), [ADRs](docs/adr/).          |
| [`.github/workflows/`](.github/workflows/ci.yml) | CI: typecheck → lint → format → test → build on push/PR.                                                |

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

| Component                                           | Responsibility                                                                                                 |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `AgentRegistry`                                     | Validate and store declarative agents; look up by capability / eligibility.                                    |
| `TaskSystem`                                        | Own the deterministic task lifecycle; reject illegal transitions.                                              |
| `HandoffSystem`                                     | Propose / accept / reject validated agent-to-agent handoffs.                                                   |
| `Orchestrator`                                      | Validate → enforce permissions → gate on approval → dispatch → record. `resume` after a decision. No autonomy. |
| `PermissionSystem`                                  | Deny-by-default evaluation scoped by agent/project/tool/action/environment; enforced at dispatch.              |
| `ApprovalSystem`                                    | Record human approvals: `requested → approved \| rejected \| expired`. Never auto-approves.                    |
| `ContextSystem`                                     | Task / project / agent context, isolated per project.                                                          |
| `AuditLog`                                          | Structured events to a pluggable sink; queryable; optionally persisted.                                        |
| `Repository<T>` / `PersistenceProvider`             | The only persistence types the core knows. In-memory default, JSON-file durable adapter.                       |
| `ModelProvider` / `ToolProvider` / `ProjectAdapter` | Vendor- and project-neutral seams.                                                                             |

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
- Project context does not cross project boundaries.
- No secrets in the repo or in persistence. Providers read credentials from the
  environment at call time; the Anthropic adapter redacts the key from every
  error message and never logs it.
- `.env` is git-ignored; `.env.example` contains placeholders only.
- CI runs without any secret or AI credential.
