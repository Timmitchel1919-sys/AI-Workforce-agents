# ADR-0008: Money Mind project adapter

**Status:** Accepted
**Date:** 2026-09-07
**Related:** [ADR-0001](0001-modular-provider-agnostic-workforce.md) (the
`ProjectAdapter` boundary itself), [ADR-0006](0006-tool-execution-framework.md)
(tool security pipeline), [ADR-0007](0007-multi-agent-workflow-orchestration.md)

## Context

Phase 6 needs the first real `ProjectAdapter` — reaching an actual, external,
independent project (Money Mind) through the interface Phase 1 already
declared but never implemented. The brief is explicit that Money Mind must
stay independent (no source copy, no merged repositories) and that the
integration must be read-only first, with write/deploy capabilities
documented but not built.

## Decisions

### 1. No Money Mind content ships as real Money Mind content

Every test and the demonstration workflow use `InMemoryMoneyMindRepo`, whose
fixture content is written from scratch for this repository — structurally
analogous to what inspecting the real repository found (a layered,
feature-flagged V2 status doc; README/CLAUDE/AGENTS/docs-v2; a representative
source tree) but no string, filename choice beyond generic convention, or
value is copied from the real project. This keeps "no source copy" true by
construction, not just by promise, and keeps CI fully offline (no clone
required to run the test suite).

### 2. Repository access is a local filesystem adapter, chosen after inspection, not assumed

The brief listed several candidate mechanisms (local adapter, Git operations,
CLI wrapper, API, read-only filesystem interface) and required inspecting the
real repository before choosing. Inspection found: a Vite/React/Firebase app
with no `test` npm script, a `tsconfig.json` scoped only to `remotion/`
(not `src/`), and `oxlint` for linting — no CI test command to shell out to,
no API to call, and Git-history operations are unnecessary for a read-mostly
integration. A local filesystem port (`MoneyMindRepoPort`: `exists` /
`readTextFile` / `listDirectory` / `hasScript` / `runScript`) is the simplest
mechanism that satisfies every requirement, with two implementations —
`InMemoryMoneyMindRepo` (fixture) and `NodeMoneyMindRepo` (real, fs +
`child_process`, wiring-only, never imported by a test or by `core/`).

### 3. The command allowlist is closed and existence-checked, not just closed

`RUN_TESTS` accepts only one of a fixed `MoneyMindScript` enum
(`build | lint | test | typecheck`) — never a raw string — validated by
`validateMoneyMindRunTestsInput` before the request reaches the tool engine
at all. Because the real Money Mind repository, as inspected, defines `build`
and `lint` but not `test` or `typecheck`, the adapter additionally checks the
target's own `package.json` at call time (`hasScript`) and reports
`available: false` without spawning anything for a script that does not
exist there. Two independent gates, not one: the closed enum prevents
anything outside a small, pre-approved set; the existence check prevents
acting on a script that was never actually configured.

### 4. `READ_DOCUMENTATION` is `execute`, so it can be Research's `searchToolId` unmodified

Every other read capability is `PermissionAction: "read"`; `READ_DOCUMENTATION`
is deliberately `"execute"` so `money-mind.read-docs` can be wired directly
as `ResearchAgent`'s `searchToolId` — `ResearchAgent.search()` (Phase 3, never
modified) always requests action `"execute"`, exactly like the existing
`research.search` tool. `money-mind.read-file` doubles as `fetchToolId` the
same way (`"read"`, matching `ResearchAgent.fetch()`), with a small
`reference` → `path` alias in the tool wrapper (not the adapter) so the
adapter's own `READ_FILE` contract stays `{ path }`-shaped for direct callers
(Developer, QA) while still satisfying Research's fixed `{ reference }`
calling convention. This lets the demonstration workflow run the actual,
unmodified `ResearchAgent` pipeline against Money Mind data — no new
tool-calling shape was invented, and ADR-0005's "General Agent reusability"
claim is proven against a second, real integration rather than only the
first (mock research tools).

### 5. Project Manager, Developer, and QA are granted Money Mind eligibility but not wired into their own `run()`

Per Phase 5 (ADR-0007 decision 4), none of these three agents call a tool
from inside their own pipeline yet. Rather than expand their `run()` methods
in this phase — which the brief does not ask for and which would grow the
security surface before there is a concrete consumer — their Money Mind
tool eligibility (`INSPECT_STRUCTURE`/`READ_FILE`/... for Developer and QA,
`READ_STATUS`/`READ_PROJECT` for Project Manager) is granted at the
permission + tool-registry layer and proven directly against the
`ToolExecutionEngine` in `tests/money-mind-agents.test.ts` — the same
boundary a future tool-calling step in any of these agents would go through.
`ProjectManagerAgentDefinitionOptions`, `DeveloperAgentDefinitionOptions`, and
`QaAgentDefinitionOptions` (and Research's own options) each gained an
additive, optional `extraAllowedTools` / `extraGrants` pair — empty by
default, so every Phase 5 test and behavior is unchanged — rather than a
Money-Mind-specific field, so the same seam serves the next project adapter
too.

### 6. Adapter-level auditing stays out of the adapter; the wiring layer emits it

`MoneyMindProjectAdapter`, like every other adapter, depends only on
`contracts/` — never on `core/`'s `AuditLog`. Every operation invoked as a
`Tool` is already fully audited by the existing `ToolExecutionEngine`
(`tool_execution` phases, `permission_decision`, `approval_requested` /
`approval_decided`) — nothing new was needed there. The one gap (recording
that the adapter itself was constructed) is closed by one new audit type,
`project_adapter_event`, emitted once by the wiring layer immediately after
construction — not by adding an `AuditLog` dependency to the adapter class.

## Options considered

| Concern                     | Chosen                                              | Rejected                                                                                                       |
| --------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Repository access           | local filesystem port (fixture + real fs backend)   | Git CLI wrapper (unneeded for a read-mostly integration); a network API (none exists)                          |
| Command execution           | closed enum + live `package.json` existence check   | trusting the allowlist alone (would let `RUN_TESTS` claim success on a nonexistent script)                     |
| Windows `.cmd` spawning     | `cmd.exe` as the executable, argv array             | `shell: true` + array (Node's own docs warn this can leave args unescaped)                                     |
| Research integration        | reuse `ResearchAgent` unmodified via tool-id wiring | adding a generic "call any Money Mind tool" step to `ResearchAgent.run()` (unnecessary surface for this phase) |
| PM/Developer/QA tool access | grant + engine-level tests, no `run()` change       | expanding all three agents' pipelines now (scope creep beyond the brief)                                       |

## Consequences

- Money Mind stays genuinely independent: its own Git history, its own
  deploys, nothing in this repository can reach either.
- The next project adapter (AIMS, Mastery, Tripod Product) has both a working
  reference implementation and a documented recipe
  (`docs/extending.md` §"Adding a project adapter") that requires no `core/`
  change.
- A future "controlled write" phase has a concrete, already-documented shape
  to build against (`docs/projects/money-mind.md` §15) and an established
  pattern (closed enum + existence check, never a raw string) to extend to
  `CREATE_FILE`/`CREATE_COMMIT`/etc. when that phase is explicitly
  authorized.
- `MoneyMindProjectAdapter`'s own capability-to-action map
  (`MONEY_MIND_CAPABILITY_ACTIONS`) is a single source of truth the tool
  definitions and the permission grants both read from — they cannot silently
  drift out of sync the way two independently hand-written literal lists
  could.
