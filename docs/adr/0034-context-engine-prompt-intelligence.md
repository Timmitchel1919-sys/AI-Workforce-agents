# ADR-0034: Context Engine + AI Prompt Intelligence Layer

## Status

Accepted (Phase 3)

## Context

The user gives natural-language requests ("Maak de AIMS login card smaller van
boven en beneden, maar verander niets anders."). Agents need an execution-ready,
bounded, safe prompt — not the raw sentence, and not the whole project dumped in.
This layer establishes that intelligence **before** execution. It is a private,
single-user platform: no tenancy, organizations or enterprise RBAC are
introduced.

## Decision

```
USER → Command Center → Intent Analyzer → Context Engine → Prompt Engineer
     → Prompt Validator → (Phase 4) Project Manager / Workflow Engine → Agent Router → …
```

Phase 3 implements everything up to and including the Prompt Validator and
produces a typed `PreparedExecutionRequest`. **Nothing here executes an agent,
tool or command.**

### What is reused (no duplicate systems)

| Need | Existing system used |
| --- | --- |
| Project identity / repository | `ProjectRegistry` |
| Project configuration | `ContextSystem` (project-isolated) |
| Knowledge / decisions | the Knowledge repository (`knowledge_items`) |
| Capability vocabulary | `contracts/capabilities.ts` taxonomy (`canonicalizeCapability`) |
| Human approval | `ApprovalSystem` + the existing `approve`/`reject` commands |
| Audit | `AuditLog` (`control_command` events) |
| Discovered project facts | the approved onboarding plan (`provisioned_projects`) |
| Repository file lookup | the read-only `RepositorySourceReader` (GitHub) |
| Prompt artifact | the `Prompt` entity (`contracts/prompt.ts`) |

### Components (`core/prompt-intelligence/`)

- **Intent Analyzer** — rule-based, deterministic, Dutch + English. Deliberately
  *not* model-assisted: an analysis that feeds destructive-action and approval
  decisions must be explainable and reproducible. The `IntentAnalyzer` port
  allows a model-assisted analyzer later; the validator re-checks any analyzer.
- **Context Engine** — pluggable `ContextSource`s → safety filter → precedence →
  relevance scoring → budget. For every fragment it records what, why
  (relevance reasons), which source, authority, and sensitivity. A failing
  source degrades to a report entry and never leaks its error.
- **Prompt Engineer** — deterministic, template-driven; sections with nothing to
  say are omitted; context is the relevance-filtered set only.
- **Prompt Validator** — independent last gate (`PASS | WARN | CLARIFY |
  APPROVAL_REQUIRED | BLOCKED`).
- **PromptIntelligenceService** — authorization, bounds, secret refusal,
  isolation, traceability, approval hand-off.

### Context precedence

1 explicit user instruction · 2 project security policy · 3 project architecture
rules · 4 approved project decisions · 5 current task context · 6 project
documentation · 7 general defaults. Security fragments are mandatory and are
never overridden: an instruction that conflicts with one is recorded as a
`ContextConflict` and the request is `BLOCKED`.

### Security properties (enforced server-side)

- `prepare_prompt` capability (operator, admin); reads need `view` plus project
  access. A project-scoped operator can neither target nor see another project;
  foreign and unresolved records are indistinguishable from missing (no IDOR).
- Project resolution considers only projects the principal may access.
- A request containing a credential is refused and never stored or echoed;
  context fragments containing credentials are dropped whole.
- `restricted` fragments reach only a `restricted`-cleared audience; clearance
  is server-derived (`internal`) and cannot be raised by the client.
- Destructive requests (files, repositories, projects, agents, workflows,
  integrations, environments, configuration, secrets, databases, history
  rewrite) and production deployments yield `APPROVAL_REQUIRED`. An approval is
  created only on explicit request, through the existing `ApprovalSystem`,
  stamped with the project id so existing scoping applies.
  `executionReady` is true only after a human approves.
- Instructions that weaken a security control are never applied (`BLOCKED`).
- Audit records carry traceability metadata (request id, project, intent,
  context sources, prompt version, capabilities, validation, approval,
  execution state) but not the request or prompt text.

### Traceability

`prompt_requests/{requestId}` holds the secret-free trace. `executionState` is
`not_started`; Phase 4 advances it.

### Extension points

`ContextSource` (GitHub, design system, external research, connected apps …),
`RelevantFileResolver`, `IntentAnalyzer`.

## Known gaps (reported, not hidden)

- The analyzer is rule-based; novel phrasings fall back to `UNKNOWN` →
  `CLARIFY`, never to a guess.
- Production wires no `ProjectContextValuesSource` values (nothing writes them
  yet); project facts come from the registry, the AI Workforce repository
  profile, approved onboarding plans, Knowledge and task history.
- Relevant-file lookup works for public GitHub repositories (and private ones
  once the server-side read credential exists).
- Required capabilities are requirements; whether a registered agent offers them
  is surfaced as a warning only — selection belongs to the Phase 4 Agent Router.
