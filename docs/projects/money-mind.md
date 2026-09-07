# Money Mind Project Adapter

The first real `ProjectAdapter` — a controlled, read-mostly integration
boundary between the AI Workforce and the independent
[Money Mind](https://github.com/Timmitchel1919-sys/Money-Mind.git) repository
(a personal-finance web app: React + Vite frontend, Firebase backend, a
feature-flagged "V2" spatial workspace).

```
AI Workforce
    |
    v
MoneyMindProjectAdapter        (adapters/projects/money-mind/)
    |
    v
MoneyMindRepoPort              (the only boundary the adapter depends on)
    |                                  |
    v                                  v
InMemoryMoneyMindRepo          NodeMoneyMindRepo
(fixture — every test, demo)   (real fs + npm — wiring only, never a test)
    |
    v
Money Mind (local checkout, read-mostly)
```

Money Mind remains fully independent: its source is never vendored into this
repository, its history is its own, and nothing here can push, commit, or
deploy on its behalf.

## 1. No source copy

Nothing under `adapters/projects/money-mind/` contains Money Mind source,
`node_modules`, build output, or secrets. `InMemoryMoneyMindRepo`'s fixture
content (`money-mind-fixture-repo.ts`) is **synthetic test data written for
this repository** — structurally analogous to Money Mind (a layered,
feature-flagged status doc; a small doc set; a representative source tree) so
the adapter's parsing logic is exercised meaningfully, but no filename,
string, or value in it was copied from the real project. See
[ADR-0008](adr/0008-money-mind-project-adapter.md) decision 1.

## 2. Money Mind project profile

`adapters/projects/money-mind/money-mind-profile.ts` declares, in one place:

- `projectId: "money-mind"`, display name, repository URL.
- `allowedCapabilitiesByAgent` — which of the four agents get which
  capabilities (see §5).
- `MONEY_MIND_CAPABILITY_ACTIONS` — the one `PermissionAction` each
  capability requires (single source of truth shared by the tool definitions
  and the permission grants, so they cannot drift apart).
- `moneyMindGrants(agentId)` — the least-privilege `PermissionGrant[]` for one
  agent, and `allMoneyMindGrants()` for wiring every agent at once.

## 3. The adapter

`MoneyMindProjectAdapter` (`money-mind-project-adapter.ts`) extends the
existing `BaseProjectAdapter` (unchanged from Phase 1). It owns every piece of
Money-Mind-specific domain knowledge — which files carry status, how to parse
them — behind the generic `MoneyMindRepoPort`. Nothing above it (agents, the
orchestrator, core) knows Money Mind's actual file layout.

## 4. Capabilities (this phase)

| Capability           | Action    | Reads                                                     |
| -------------------- | --------- | --------------------------------------------------------- |
| `READ_PROJECT`       | read      | identity: name, repository, package name/version          |
| `READ_STATUS`        | read      | `docs/v2/chapter-registry.yaml` + feature-flag names      |
| `READ_TEST_RESULTS`  | read      | whether a `test` npm script is defined                    |
| `READ_CONFIGURATION` | read      | package name/version, npm scripts, feature flags          |
| `READ_FILE`          | read      | one sandboxed, repository-relative text file              |
| `INSPECT_STRUCTURE`  | read      | bounded directory listing (paths + type only)             |
| `READ_DOCUMENTATION` | execute\* | README/CLAUDE/AGENTS/docs-v2, optionally keyword-searched |
| `RUN_TESTS`          | execute   | runs one allowlisted, **existing** npm script             |

\* `READ_DOCUMENTATION` is action `execute`, not `read`, so it can be wired
as the Research Agent's `searchToolId` — `ResearchAgent.search()` always
requests action `"execute"` (the same convention `research.search` already
uses). See ADR-0008 decision 4.

**Not implemented this phase** (`MONEY_MIND_FUTURE_CAPABILITIES`, documented
only, no code path, no tool, no permission grant exists for any of them):
`CREATE_FILE`, `MODIFY_FILE`, `CREATE_BRANCH`, `CREATE_COMMIT`,
`CREATE_PULL_REQUEST`, `DEPLOY`.

## 5. Agent access (capability-based, never blanket)

| Agent           | Capabilities                                                                             |
| --------------- | ---------------------------------------------------------------------------------------- |
| Research Agent  | `INSPECT_STRUCTURE`, `READ_DOCUMENTATION`, `READ_STATUS`, `READ_FILE`                    |
| Developer Agent | `INSPECT_STRUCTURE`, `READ_FILE`, `READ_CONFIGURATION`, `READ_TEST_RESULTS`, `RUN_TESTS` |
| QA Agent        | same as Developer                                                                        |
| Project Manager | `READ_STATUS`, `READ_PROJECT`                                                            |

No agent is granted `write`/`deploy`/`external_communication`/`secret_access`
on `money-mind` — every one of the four is explicitly **denied** those
actions (`moneyMindGrants`), regardless of its read/execute grants.

Research's `READ_FILE` grant exists so `money-mind.read-file` can double as
its `fetchToolId` (its fixed pipeline always fetches-by-reference after a
search hit) — see §7.

## 6. The tool boundary

Agents never call `MoneyMindProjectAdapter` directly. Every capability is a
named `Tool` (`money-mind-tools.ts`) that goes through the
`ToolExecutionEngine` exactly like the Research Agent's own `research.search`
/ `research.fetch` — validate → resolve → eligibility → limits → permission
→ approval → execute → audit.

| Tool id                        | Capability           | `allowedAgents`                           |
| ------------------------------ | -------------------- | ----------------------------------------- |
| `money-mind.read-project`      | `READ_PROJECT`       | Project Manager                           |
| `money-mind.status`            | `READ_STATUS`        | Research, Project Manager                 |
| `money-mind.read-test-results` | `READ_TEST_RESULTS`  | Developer, QA                             |
| `money-mind.read-config`       | `READ_CONFIGURATION` | Developer, QA                             |
| `money-mind.read-file`         | `READ_FILE`          | Research, Developer, QA                   |
| `money-mind.test`              | `RUN_TESTS`          | Developer, QA — **always approval-gated** |
| `money-mind.inspect`           | `INSPECT_STRUCTURE`  | Research, Developer, QA                   |
| `money-mind.read-docs`         | `READ_DOCUMENTATION` | Research                                  |

Every tool sets `allowedProjects: ["money-mind"]` — never the `"*"` wildcard
`research.search`/`research.fetch` use — so a request scoped to any other
project is denied at the tool-eligibility layer before permissions are even
evaluated.

## 7. Repository access mechanism

Chosen after inspecting the real Money Mind repository (Vite/React/Firebase,
no `test` npm script, `tsconfig.json` scoped only to `remotion/`, `oxlint` for
linting): a **local filesystem adapter**, not a Git-operations wrapper or a
network API — the simplest, most direct mechanism that satisfies every
security requirement without adding a dependency.

- `MoneyMindRepoPort` (`money-mind-repo-port.ts`) — the narrow interface the
  adapter depends on: `exists`, `readTextFile`, `listDirectory`, `hasScript`,
  `runScript`. Nothing else.
- `InMemoryMoneyMindRepo` — deterministic, synthetic, **used by every test and
  the demonstration workflow**. Never touches disk or a process.
- `NodeMoneyMindRepo` (`money-mind-fs-repo.ts`) — the **only** module in this
  repository allowed to import `node:fs` or `node:child_process` for Money
  Mind. Used only at real wiring time.
- `loadMoneyMindConfig(input?, env?)` — resolves `repoPath` from an explicit
  value, then `MONEY_MIND_REPO_PATH`, else returns `undefined`. **Never
  throws** — an unconfigured/unavailable local checkout is a normal, expected
  state (CI, a fresh clone, no local Money Mind checkout on this machine);
  the wiring layer decides whether to register the real backend at all.
  Every `NodeMoneyMindRepo` operation additionally fails safely
  (`NotFoundError`, never a raw `ENOENT`) if the configured path turns out not
  to exist when actually used.

## 8. File-access security

`resolveSafeRelativePath` (`money-mind-path-policy.ts`) — pure, shared by
both backends, so the exact same rules apply whether the target is the
fixture or a real checkout:

- Rejects an absolute path (POSIX `/...` or a Windows drive letter).
- Rejects any `..` segment (traversal), including `src/../../outside.txt`.
- Rejects a NUL byte.
- Rejects a **sensitive segment** anywhere in the path: `.env*`, `.git`,
  `.firebase`, `node_modules`, anything matching `credential`/`secret`,
  `*.pem`, `*.key`, `id_rsa*`, `serviceAccount*.json`,
  `firebase-debug.log`.
- An empty string resolves to the repository root itself (a valid, explicit
  target for `INSPECT_STRUCTURE`/`listDirectory`) — never treated as "no
  path supplied" (that is rejected earlier, by `requireText` on the raw
  input).

`NodeMoneyMindRepo` re-checks containment a second time against the resolved
**absolute** path (`path.resolve(root, safe).startsWith(root + sep)`) —
belt-and-braces against a symlink or another OS-specific edge case the
string-level check alone would not catch.

Every file read is capped (256 KiB by default) and truncated with a
`truncated: true` flag rather than ever returning an unbounded payload.

## 9. Command allowlist

`RUN_TESTS` may only run one of `MONEY_MIND_ALLOWED_SCRIPTS`:
`build | lint | test | typecheck` — a closed TypeScript union, never a raw
string from the model. `validateMoneyMindRunTestsInput` rejects anything else
(`"deploy"`, `"build; rm -rf /"`, `"$(rm -rf /)"`, ...) with a
`ValidationError` before any process is ever considered.

The real Money Mind repository, as inspected, defines `build` (`vite build`)
and `lint` (`oxlint`) but **no `test` or `typecheck` script** — so
`RUN_TESTS` additionally checks the target's own `package.json` at call time
(`hasScript`) and reports `{ available: false, message: ... }` without
spawning anything if the requested script does not actually exist there. This
is why the allowlist is a fixed set of _plausible_ script names, each gated
by a live existence check, rather than a hard assumption that all four exist.

`NodeMoneyMindRepo.runScript` never accepts a string command. On Windows,
where `npm.cmd` cannot be spawned directly, it invokes `cmd.exe` itself as
the executable with `npm`, `run`, and the (already-validated) script name as
separate argv elements — not `shell: true` plus string concatenation (which
Node's own `child_process` documentation flags as capable of leaving
arguments unescaped). The child process runs with a minimal, explicit
environment (`PATH`/`SystemRoot`/... only) — never the Workforce process's
full `env`, which may hold unrelated provider credentials.

## 10. Permissions

Deny-by-default, unchanged. Example (from `tests/money-mind-adapter.test.ts`):

```
Agent: Research Agent   Project: money-mind   Action: read     -> allowed
Agent: Research Agent   Project: money-mind   Action: write    -> denied
Agent: Developer Agent  Project: money-mind   Action: deploy   -> denied
Agent: <unrelated>      Project: money-mind   Action: read     -> denied (default)
```

## 11. Approval

Per the phase brief: reads never require approval; `RUN_TESTS` always does
(`money-mind.test`'s `approvalPolicy: { always: true }`) — the only
capability in this phase that spawns a real process. A rejected approval
denies the run and nothing is spawned; an approved one resumes and actually
runs the script. Write/commit/push/deploy have no code path to gate — they do
not exist yet.

## 12. Context isolation

No new mechanism — `ContextSystem` is already project-scoped (Phase 1).
`money-mind` context is set and read under its own `projectId` and is not
visible under `"aims"`, `"mastery"`, `"tripod-product"`, or any other project
id; no cross-project sharing is implemented.

## 13. Audit

Every Money Mind operation is invoked as a `Tool`, so the existing
`tool_execution` phases (`requested → validated → resolved → authorized →
[approval_required → approved] → executing → completed | failed | timeout |
denied | limit_exceeded`) and `permission_decision` / `approval_requested` /
`approval_decided` events already cover the phase brief's full audit
checklist (project accessed, operation requested/authorized/denied, file
accessed, test executed, command rejected, approval requested/received,
completed/failed) — nothing new to build there. One new type,
`project_adapter_event` (`data.kind: "adapter_initialized"`), covers adapter
construction itself; the wiring layer emits it once, right after constructing
`MoneyMindProjectAdapter` (kept out of the adapter class itself, which — like
every other adapter — depends only on `contracts/`, never on `core/`'s
`AuditLog`). No credential, token, or raw filesystem path is ever logged.

## 14. Demonstration workflow

`tests/money-mind-demo.test.ts` — fully offline, deterministic:

```
Project Manager (decompose)
      |
      v
Research Agent  --money-mind.read-docs / money-mind.read-file-->  Money Mind (fixture)
      |
      v
QA Agent (verifies the research report against acceptance criteria)
      |
      v
Project Manager (summarize) -> Structured Report (finalStatus: "completed")
```

Objective: _"Inspect the current Money Mind V2 development state and report
what is complete, what tests exist, and what should be worked on next."_
Research's `ResearchResult` cites a real (fixture) Money Mind documentation
path as a verified source; QA independently validates against
`validateQAResult`; the whole run is confirmed never to have called
`runScript` (`repo.runCalls.length === 0`) — Money Mind is never modified.

## 15. Future write workflow (architecture only — not implemented)

Documented so a later phase has a stable shape to implement against; no code
exists for any step below:

```
Developer Agent -> Inspect Money Mind -> Implementation plan -> Human approval
  -> Controlled modification -> Tests -> QA -> Human approval -> Commit
  -> Human approval -> Push
```

Every arrow into "Human approval" is a hard requirement, not a suggestion —
consistent with §9's rule that write/commit/push/deploy are approval-gated
(and deploy is additionally a candidate for permanent denial). Building this
requires, at minimum: `CREATE_FILE`/`MODIFY_FILE` capabilities with the same
path-safety and denylist rules as `READ_FILE`; a real Git wrapper (branch,
diff, commit, push) with the same "closed allowlist, never a raw string"
discipline as `RUN_TESTS`; and never a force-push or history reset, ever.

## 16. Security controls summary

| Threat                    | Control                                                                                                                                      |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Path traversal            | `resolveSafeRelativePath` (string-level) + `NodeMoneyMindRepo` (OS-level containment re-check)                                               |
| Command injection         | Closed `MoneyMindScript` enum, validated before any process is spawned; argv array, never a shell string                                     |
| Arbitrary shell execution | No tool accepts a free-text command; `RUN_TESTS` only ever runs `npm run <allowlisted-script>`                                               |
| Cross-project access      | `allowedProjects: ["money-mind"]` on every tool (no `"*"`); `ContextSystem` project scoping                                                  |
| Secret access             | Denylisted filename patterns (`.env*`, credentials, keys, service-account JSON); child process gets a minimal env, never the Workforce's own |
| Unauthorized writes       | No write/modify capability exists in code this phase                                                                                         |
| Unauthorized git push     | No git-write operation exists in code this phase                                                                                             |
| Unauthorized deployment   | No deploy capability, tool, or grant exists in code this phase                                                                               |

## 17. Reusable template for the next project adapter

See [docs/extending.md](../extending.md) §"Adding a project adapter" for the
generic recipe (already updated to reference this adapter). In short, for
AIMS, Mastery, or Tripod Product: define a `<Project>RepoPort` (or reuse
`MoneyMindRepoPort`'s shape if the mechanism fits), a fixture + a real
backend, a `<project>-project-adapter.ts` extending `BaseProjectAdapter` that
owns that project's domain knowledge, a profile with per-agent capabilities
and grants, and a tool layer wrapping each capability — no change to `core/`
required for any of it.

## 18. Known limitations

- `READ_STATUS`/`READ_CONFIGURATION` parse `docs/v2/chapter-registry.yaml`
  with a small, purpose-built line scanner (`money-mind-status-parser.ts`),
  not a general YAML parser — it recognizes exactly the shape this project's
  status doc uses today and ignores anything else, rather than failing loudly
  on a differently-shaped file.
- `RUN_TESTS`'s allowlist (`build`/`lint`/`test`/`typecheck`) is a fixed,
  hand-chosen set of plausible script names; a project using a different
  script name for its quality gate (e.g. `check`) is not reachable without a
  contract change.
- No dynamic recheck: the demonstration workflow inspects the configured
  checkout once per run; nothing polls Money Mind for drift between
  inspections.
- The real backend (`NodeMoneyMindRepo`) requires a local Money Mind checkout
  at `MONEY_MIND_REPO_PATH`; there is no remote/API-based mechanism in this
  phase (deliberately — a local filesystem adapter was the simplest
  mechanism that satisfied every requirement, see §7).
- No write, commit, push, or deploy capability exists — by design, per §15.
