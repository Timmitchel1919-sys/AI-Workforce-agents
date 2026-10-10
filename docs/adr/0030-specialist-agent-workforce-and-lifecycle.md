# ADR-0030: Specialist Agent Workforce & Agent Lifecycle Management (EO-8)

- Status: Accepted
- Date: 2026-09-27

## Context

ADR-0029's masterprompt named this as the likely next layer but required
verifying real repository state first rather than assuming it. Preflight
found a concrete, verified gap: `agents/developer`, `agents/qa`, and
`agents/project-manager` are each a fully implemented, individually tested
`GeneralAgent` subclass (a real `ModelProvider`-driven planning/evaluation
pipeline, not a stub) with its own declarative definition factory
(`make*AgentDefinition`) explicitly shaped to be called from a composition
root — and `core/workflows/workflow-engine.ts` already fully implements
decompose → assign-by-eligibility → execute → summarize across
`AgentRegistry` lookups, itself already composed in
`api/production-control-plane.ts`. None of the three agents were ever
registered anywhere in production (`api/production-workforce-config.ts`
declared exactly one agent: `control-plane-analysis-agent`). The
orchestration machinery existed and was tested; the workforce it was meant
to orchestrate did not exist in production at all.

Separately, `AgentOperationalStore` (the enable/disable mechanism a prior
layer's audit called for) is keyed ONLY by `agentId` — a single global
enabled/disabled flag per agent across every project, with no project
dimension. This is the exact, previously-documented gap ("agent
enable/disable commands lack project scope").

## Decision

### Part A — Wiring the specialist agents into production

Reused, not reinvented: the SAME reviewed EO-7 pipeline (Model Router →
Cost Center → Governance), the SAME `RoutingAgentExecutor.replace`
two-phase bootstrap pattern, the SAME `LazyOpenAIModelProvider` (the one
real provider this deployment has).

**`RoutedModelProvider`** (`core/routing/routed-model-provider.ts`) — a
`ModelProvider` DECORATOR generalizing the routing/metering wiring EO-7
hand-rolled inside `OpenAIAgentExecutor.run()` (which uses the richer
`StructuredModelProvider` interface) into something reusable for any
`GeneralAgent`-based agent that takes a plain, injected `ModelProvider`.
Wrapping happens ONLY at the composition root; `DeveloperAgent`, `QaAgent`,
and `ProjectManagerAgent` needed ZERO code changes — each already accepts
an injected `ModelProvider` and already maps `ProviderUnavailableError` to
a `"model_unavailable"` failure, which is exactly what a routing denial
throws here. SELECTED != EXECUTED is enforced the same way: routing runs
strictly before `inner.generate()`, and a denied/unavailable/unknown
outcome throws instead of falling through. REQUESTED MODEL != ACTUAL MODEL
is still tracked and audited (as an `agent_activity`/`model_mismatch`
event, replicating `AgentRun.activity`'s exact shape since no `AgentRun`
exists at the provider-decorator layer). Usage is recorded post-response,
idempotent per `taskId`, identical to EO-7's guarantee.

`api/production-workforce-config.ts` now declares `DEVELOPER_AGENT`,
`QA_AGENT`, `PROJECT_MANAGER_AGENT`, each scoped to `allowedProjects:
["money-mind"]` — the SAME single project `GovernancePolicyStore.setTrusted`
already marks `allowUnknownCost: true` for (none of these three has a
pre-call cost estimator either, same ADR-0029 rationale). Widening to
`ai-workforce` would mean either building a real cost estimate or trusting
a second project on unknown cost — deferred as a deliberate choice, not
done as an unreviewed side effect of this wiring.

Each is bound at bootstrap time to a real-but-UNROUTED provider (the same
reason `openai-control-plane-analysis` does), then immediately replaced
(`RoutingAgentExecutor.replace`) with a `RoutedModelProvider`-wrapped
instance once the Router/Cost Center exist in the composition root —
nothing reaches the unrouted binding for a real request.

**`RESEARCH_AGENT` is deliberately NOT wired.** Its only real tools
(`agents/research/research-agent-definition.ts`'s `research.search` /
`research.fetch`) have exactly one implementation in this repository:
`adapters/tools/static-research-tools.ts`, whose own doc comment says
plainly: "a reference implementation and a deterministic test double... A
real deployment supplies a vetted search/fetch provider." Wiring the
Research Agent into production against that fixed, offline corpus would
present canned test results as real, source-grounded research — the exact
fabrication this project's entire discipline exists to prevent. No fake
search/fetch adapter was invented to work around this (same rule ADR-0029
applied to "no fake Anthropic/Google/local integrations"). The Research
Agent, its tools, and `WorkflowEngine`'s ability to dispatch to it all
still work correctly the moment a real search/fetch provider is registered
— no Router, executor, or `WorkflowEngine` change required, mirroring
ADR-0029's "adding a second real provider requires no Router change" claim.

### Part B — Project-scoped agent lifecycle

[To be completed in this same layer — see the implementation that follows.]

## Consequences

- The orchestration machinery `WorkflowEngine` already had (decompose →
  assign → execute → summarize) can now actually reach three more real,
  governed, metered, audited agents in production, not just
  `control-plane-analysis`.
- `bootstrap.report.agentCount` honestly changes from 1 to 4 — a correction
  toward completeness, not a new capability invented; existing tests
  asserting the old count were updated, not weakened.
- `RoutedModelProvider` is now the preferred integration point for any
  FUTURE plain-`ModelProvider`-based agent a later layer wires into
  production (the Research Agent included, once a real tool provider
  exists) — no further Router/Cost-Center wiring is needed per agent, only
  a `RoutedModelProvider` instance at the composition root.
