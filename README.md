# AI Workforce — Agents

Reliable foundation for an AI agent workforce: a declarative agent registry, a
deterministic task lifecycle, structured agent-to-agent handoffs, a minimal
deterministic orchestrator with **approval-gated execution** and
**permission enforcement at the dispatch boundary**, deny-by-default
permissions, human approval records, project-isolated context, a structured
audit log, and **durable persistence behind an interface** — all behind
**provider- and project-agnostic contracts**.

> **Status: Phase 2A complete.** No real AI providers, no autonomous/general
> agents, no network calls. Money Mind will be the first real integration in a
> later phase; its source is never copied here.

## Stack

- **TypeScript** (strict) on **Node.js ≥ 20**, ESM (`NodeNext`)
- Tests: built-in `node:test` + `node:assert/strict` (62 deterministic, offline)
- Build: `tsc` only
- Persistence: `Repository<T>` interface; JSON-file store as the first
  implementation ([ADR-0002](docs/adr/0002-local-json-file-persistence.md))
- Lint/format: ESLint 9 + Prettier 3, **dev-only**
  ([ADR-0003](docs/adr/0003-code-quality-tooling.md))
- **Zero runtime dependencies**

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
  environment at call time.
- CI runs without any secret or AI credential.
