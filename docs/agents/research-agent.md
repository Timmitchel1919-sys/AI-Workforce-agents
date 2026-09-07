# Research Agent

The first reusable **General Agent**. It runs a bounded, source-grounded
research workflow and returns a structured `ResearchResult`. It contains no
project-specific logic — projects are integrated later through Project Adapters.

## 1. Architecture

```
Task (type "research", input = ResearchTask)
  │
  ▼ Orchestrator  ── permission gate ── approval gate ──▶ RoutingAgentExecutor
  │                                                          │  agent.id = "research-agent"
  ▼                                                          ▼
GeneralAgent.execute()                                   ResearchAgent (extends GeneralAgent)
  validateInput → run(...) → validateOutput
  audits agent_activity at every phase, enforces AgentLimits, fails closed
  │
  ▼ ResearchAgent.run()
    load project + task context  (ContextSystem, this project only)
      → plan sub-questions + queries        ── ModelProvider ──▶ (Anthropic adapter, or any)
      → for each query: research.search     ── ToolProvider ───▶ (search/fetch provider)
          for each hit: research.fetch → evaluate → ResearchSource
      → synthesize findings                 ── ModelProvider ──▶
      → deterministic post-processing (drop bogus citations, downgrade
        unsupported facts, compute confidence)
      → build ResearchResult → validateResearchResult
```

Reusable framework pieces (in `core/agents/`):

| Piece                           | Responsibility                                                                                                                    |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `GeneralAgent<TInput, TOutput>` | Fixed pipeline, limits, one structured failure type, audit. Subclasses implement `validateInput` / `run` / `validateOutput` only. |
| `AgentRun`                      | Per-execution meter (`countToolCall` / `countModelCall` / `nextIteration` / `checkDeadline`) + `agent_activity` emitter.          |
| `RoutingAgentExecutor`          | `AgentExecutor` that dispatches to a per-agent executor by `agent.id`, so many agents sit behind the one orchestrator executor.   |

## 2. Research task contract

`ResearchTask` (carried in `Task.input`), validated by `validateResearchTask`:

| Field             | Required            | Notes                                                       |
| ----------------- | ------------------- | ----------------------------------------------------------- |
| `objective`       | yes                 | Why the research is being done.                             |
| `question`        | yes                 | The single question to answer.                              |
| `scope`           | no                  | Bound on what to cover / exclude.                           |
| `projectContext`  | no                  | Human label only — real context comes from `ContextSystem`. |
| `constraints`     | no → `[]`           | List of constraints.                                        |
| `outputFormat`    | no → `"structured"` | `structured` \| `summary` \| `brief`.                       |
| `sourcesRequired` | no → `3`            | Target verified-source count (used by confidence).          |
| `priority`        | no                  | `Priority`.                                                 |
| `deadline`        | no                  | ISO-8601, informational.                                    |
| `metadata`        | no → `{}`           | Free-form.                                                  |

## 3. Research result contract

`ResearchResult` (returned as `Task.output`), validated by
`validateResearchResult` (called by the agent before returning):

- `taskId`, `agentId`, `question`, `executiveSummary`, `createdAt` — non-blank
- `findings[]` — `{ statement, kind, supportingSourceIds }`; `kind` ∈
  `fact | claim | assumption | inference | recommendation`; a **fact/claim
  must cite at least one known source id**
- `evidence[]` — `{ sourceId, excerpt }` (truncated retrieved text)
- `sources[]` — see §5; `relevance` and `reliability` are in `0..1`
- `assumptions[]`, `limitations[]`, `recommendations[]` — strings
- `confidence` — `{ level, score, basis }` (see §6)
- `metadata` — includes `counters` (tool/model/iteration), `projectId`,
  `contextKeys`

The agent never returns an unstructured string as the primary result; it fails
closed with an `AgentExecutionError` instead.

## 4. Tools & permissions

Two tools, invoked through the existing `ToolProvider` contract
(`execute({ tool, input, context })`):

| Tool              | Action asserted | Input           | Output (tolerated shapes)                                                        |
| ----------------- | --------------- | --------------- | -------------------------------------------------------------------------------- |
| `research.search` | `execute`       | `{ query }`     | `{ results: [{ title, reference\|url, snippet, sourceType? }] }` or a bare array |
| `research.fetch`  | `read`          | `{ reference }` | `{ title?, content\|text, sourceType?, reputation? }`                            |

Every tool call is permission-checked **before** it runs:
`permissions.evaluate({ action, toolId, agentId, projectId, environment })`.
A denial produces `AgentExecutionError("permission_denied")` and a
`agent_activity` `tool_decision` event with `allowed: false` — the tool never
executes. `researchAgentGrants()` is least-privilege: **allow** `execute
research.search` and `read research.fetch` only; **deny** `write`, `deploy`,
`secret_access`, `external_communication`. No shell, no filesystem writes, no
deployment, no outbound communication.

`StaticResearchToolProvider` (in `adapters/tools/`) is an offline reference
implementation over a fixed corpus — a deployment supplies a vetted provider
behind the same contract.

## 5. Source evaluation

A `ResearchSource` is built **only** from an actual tool response — sources are
never fabricated. If `research.fetch` returns no content (or fails), the source
is kept but marked `verified: false`, its reliability is capped at `0.25`, and
a limitation is recorded.

`reliability` is deterministic, from source type and retrieval outcome — never
from model wording:

| Source type        | base reliability |
| ------------------ | ---------------- |
| `dataset`          | 0.80             |
| `api` / `document` | 0.70             |
| `internal_note`    | 0.60             |
| `web_page`         | 0.50             |
| `unknown`          | 0.30             |

`reliability = verified ? base : min(base, 0.25)`, then, if the fetch provided a
`reputation` in `0..1`, `reliability = clamp01(0.5 * reliability + 0.5 *
reputation)`. `relevance` is rank-based (`1 - rank/total`).

Finding kinds: `fact`, `claim`, `assumption`, `inference`, `recommendation`.
Deterministic post-processing downgrades any `fact`/`claim` with no **verified**
supporting source to `assumption` and records why. Model-cited source ids that
were never collected are dropped and noted.

## 6. Confidence model

Deterministic, from evidence quality and completeness — **not** model wording
(the synthesis model is explicitly told not to assign confidence). Composite:

```
score = 0.35 * sourceCoverage   (verified sources / sourcesRequired, capped 1)
      + 0.30 * avgReliability    (mean reliability of verified sources)
      + 0.20 * supportRatio      (findings with a supporting source / all findings)
      + 0.15 * questionCoverage  (supported findings / planned sub-questions, capped 1)

level = score >= 0.70 → high ; >= 0.40 → medium ; else low
```

Hard rules: zero verified sources → `low`; a `high` score with fewer than
`min(sourcesRequired, 2)` verified sources → `medium`. `confidence.basis` spells
out every component value.

## 7. Limits & safety

`AgentLimits` (defaults; override per deployment via `ResearchAgentConfig.limits`):

| Limit                       | Default | On breach                               |
| --------------------------- | ------- | --------------------------------------- |
| `maxIterations`             | 3       | `AgentExecutionError("limit_exceeded")` |
| `maxToolCalls`              | 8       | `AgentExecutionError("limit_exceeded")` |
| `maxModelCalls`             | 4       | `AgentExecutionError("limit_exceeded")` |
| `timeoutMs`                 | 60000   | `AgentExecutionError("timeout")`        |
| `maxSources` (agent config) | 5       | stop collecting                         |

The pipeline is **linear and non-recursive** — no agent loop, no "keep calling
tools until done". `checkDeadline()` runs between every phase and every tool
call; the clock is injectable for deterministic tests.

## 8. Error handling

Every failure is an `AgentExecutionError` with a machine-readable `reason`:

| `reason`            | Cause                                                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `invalid_task`      | `task.input` fails `validateResearchTask`                                                                        |
| `missing_context`   | (reserved) required context absent                                                                               |
| `model_unavailable` | no `ModelProvider`, or `ProviderUnavailableError`                                                                |
| `model_failure`     | model threw, or returned unparseable output                                                                      |
| `tool_unavailable`  | a required tool is not on the provider                                                                           |
| `tool_failure`      | `research.search` threw (a single `research.fetch` failure degrades to an unverified source, not a hard failure) |
| `permission_denied` | a tool action was not allowed                                                                                    |
| `timeout`           | wall-clock limit exceeded                                                                                        |
| `limit_exceeded`    | iteration / tool-call / model-call ceiling hit                                                                   |
| `invalid_result`    | the produced result fails `validateResearchResult`                                                               |
| `internal_error`    | anything else                                                                                                    |

The orchestrator catches the error and moves the task to `failed` with a
`task_failed` audit event; the agent has already recorded `agent_activity`
`failed` with the `reason` and `details`.

## 9. Audit

The agent emits `agent_activity` events (one audit type, `data.kind`
discriminator) — scalable to future agents without growing the enum:

`task_received`, `started`, `context_loaded`, `model_call`, `model_result`,
`plan_ready`, `tool_decision`, `tool_requested`, `tool_result`,
`source_collected`, `synthesis`, `confidence_scored`, `result_validated`,
`completed`, `failed`.

Model calls are **also** audited as `model_execution_*` when the injected
`ModelProvider` is wrapped in `AuditedModelProvider`. No API keys, headers, or
credentials are ever recorded. Prompt/source **content is not logged** unless
`ResearchAgentConfig.logContent` (and `AuditedModelProvider.logContent`) are set
— then only truncated previews.

## 10. Project context isolation

The agent reads context only for `task.projectId`
(`ContextSystem.getProjectContext` / `getTaskContext`). It never reads another
project's context; AIMS research cannot see Money Mind context and vice versa.
The keys it loaded are recorded in `result.metadata.contextKeys` and the
`context_loaded` audit event.

## 11. Wiring

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

## 12. Creating another General Agent from this pattern

1. **Contracts** — add `contracts/<agent>.ts` with the structured task + result
   types and `validate<Agent>Task` / `validate<Agent>Result`. Re-export from
   `contracts/index.ts`.
2. **Executor** — `class <Agent> extends GeneralAgent<TInput, TOutput>` in
   `agents/<agent>/`. Implement `validateInput`, `validateOutput`, and a
   **linear** `run(input, task, agent, run, guard)`. Call
   `run.countToolCall` / `run.countModelCall` / `run.nextIteration` /
   `run.checkDeadline` before the corresponding step; emit `run.activity(kind,
data)` at each phase.
3. **Definition** — `make<Agent>Definition({ allowedProjects, modelPolicy })`
   returning an `Agent` with least-privilege `permissions` (allow only the
   tools it needs; deny `write`/`deploy`/`secret_access`/`external_communication`
   unless the agent genuinely needs them), `supportedTaskTypes`, `capabilities`,
   and `metadata` (`role`, `successCriteria`, `errorBehavior`, `limits`).
4. **Permissions** — `<agent>Grants(agentId)`; assert every tool call in `run`.
5. **Approval** — if any action is state-changing/outbound, add an
   `ApprovalPolicy` (like `researchApprovalPolicy`) that gates only those.
6. **Model & tools** — depend only on `ModelProvider` / `ToolProvider`. Never
   import a vendor SDK or a concrete adapter.
7. **Wire** — `registry.register(...)`, `router.register(id, new <Agent>(...))`.
8. **Tests** — deterministic and offline: registration, task/result validation,
   model + tool interaction (stubs), permission enforcement, context isolation,
   every limit, tool/model failure, invalid result, happy path, audit trail,
   orchestrator routing.
