# Secure Execution Foundation (EO-4.1)

> **EO-4.1 BUILDS THE CONTROL BOUNDARY. EO-4.1 DOES NOT EXECUTE ANYTHING.**
>
> There is no execute/shell/terminal API, no method that runs a command, and
> no sandbox provider that runs a process. In production every pre-flight is
> `DENIED` (baseline deny-all policy, no registered operations, no sandbox
> provider) until a later EO registers real, bounded operations, a provider
> and an explicit project policy.

## Critical invariants

| Invariant                                                 | Where it is enforced                                                                                     |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **DENY BY DEFAULT**                                       | `evaluatePolicy` — permitted only when a rule lists the operation and grants every capability it needs   |
| **NO RAW SHELL AT THE AGENT BOUNDARY**                    | Requests carry `{ operationId, input }`; no type or route carries a command string                       |
| **MODEL OUTPUT IS UNTRUSTED**                             | `validateExecutionRequest` / `validateOperationInput` reject unknown keys, enums, paths and ranges       |
| **PLAN REVISION MUST MATCH**                              | Pre-flight loads `${planId}@v${version}` exactly; superseded → `STALE_PLAN`, never "the newest"          |
| **AGENT MUST STILL BE QUALIFIED**                         | `AgentQualificationRouter.evaluateCandidates` is re-run (enabled, project, capabilities)                 |
| **ENVIRONMENT MUST STILL BE ELIGIBLE**                    | Instance + host availability and `EnvironmentRouter.evaluate` evidence are re-checked                    |
| **APPROVAL MUST STILL BE VALID**                          | The authoritative `Approval` must be approved for this project, plan document and version                |
| **WORKSPACE IS PROJECT-ISOLATED**                         | Workspace ids/rootRefs are per session + project; grants bind session/project/workspace; path validation |
| **SECRETS ARE REFERENCED, NOT STORED**                    | `secret://name` references only; `SecretBroker` issues opaque handles; no value field exists             |
| **BUILD ≠ DEPLOY PERMISSION**                             | Capabilities never imply each other (`build.invoke` ⇏ `deploy.invoke`, `repository.write` ⇏ `push`)      |
| AUTHENTICATED ≠ AUTHORIZED ≠ APPROVED ≠ EXECUTION-CAPABLE | Token (HTTP) → role capability `prepare_execution` + project scope → approval → policy + grants          |

## Architecture

```
UI (Execution readiness panel — pre-flight only)
  → POST /api/execution/preflight            (Control Plane, AUTHZ-1 principal)
  → WorkforceQueryService.executionPreflight
  → ExecutionManager                          core/execution/execution-manager.ts
       authorize (prepare_execution + project scope, 404 when out of scope)
       plan revision  → stage → registered operation + ToolRegistry/tool policy
       structured input + workspace paths
       agent revalidation → policy (deny by default) → environment revalidation
       approval revalidation → sandbox selection + limit enforcement report
  → PreflightResult { decision: ELIGIBLE | DENIED, reasons[], checks{} }
```

The `ExecutionManager` coordinates; the existing `ToolExecutionEngine` remains
the one bounded tool-call pipeline (operations must reference a tool registered
in the `ToolRegistry`, and the tool's agent/project policy is re-checked).
The only process adapter in the repository is still the pre-existing
`RestrictedCommandProbeRunner` for environment discovery (allowlisted, no shell).

## Concepts

- **ExecutionRequest** — `projectId`, `planId`, `planVersion`, `stageId`,
  optional `operationId` and structured `input`. Unknown properties (e.g.
  `command`, `risk`, `approved`) are rejected.
- **Pre-flight** — evaluates every gate and returns all failing reasons
  (`POLICY_DENIED`, `APPROVAL_REQUIRED`, `STALE_PLAN`, `PLAN_NOT_EXECUTABLE`,
  `AGENT_NOT_QUALIFIED`, `ENVIRONMENT_UNAVAILABLE`, `WORKSPACE_VIOLATION`,
  `TOOL_NOT_ALLOWED`, `INVALID_TOOL_INPUT`, `SANDBOX_UNAVAILABLE`, …).
  Deterministic for the same plan, policy, agent, environment and approval
  state. Denials are data (HTTP 200), never 500.
- **ExecutionPolicy** — immutable, versioned `(policyId, version)`; rules list
  exact operation ids and capabilities, filesystem scopes, required
  environment capabilities, network policy, secret references and limits that
  can only tighten the defaults. Explicit `forbiddenCapabilities` override
  rules; `maxRisk` caps risk; `approvalRequiredAtOrAbove` escalates. Projects
  bind to an exact version; the fallback is `baseline-deny-all@1`.
- **Execution capabilities** — `filesystem.read`, `filesystem.write.workspace`,
  `repository.read|write|commit|push|branch.manage`, `process.invoke.bounded`,
  `network.outbound.allowed-host`, `artifact.write`, `test.invoke`,
  `build.invoke`, `security.scan.invoke`, `deploy.invoke`,
  `secret.reference.use`. Distinct from an agent's general capabilities.
- **CapabilityGrant** — one capability for one session + project + agent +
  environment instance + workspace + tool + operation, with an expiry and the
  governing policy version. `grantAllows` requires an exact match.
- **Operations** — registered server-side (`ExecutionOperationRegistry`) with
  stage kind, tool id, required capabilities, a fixed **risk** (the existing
  low/medium/high approval scale plus `critical`; requests cannot set or lower
  it) and an input schema (`enum`, bounded `integer`, `workspace_path`).
- **StructuredInvocation** — for future adapters only: `executableId` +
  `operationId` + argv rendered from a server-controlled template + working
  directory reference + controlled env var names + timeout. No free-form
  arguments, no executable paths from callers, no `rawShellCommand`.
- **ExecutionSession / ExecutionAttempt** — opaque `sessionId`, exact plan
  reference, stage, operation, agent, environment instance, policy version,
  approval ids, risk, workspace, grants, limits (+ enforcement report),
  network policy, sandbox. Lifecycle `created → validating → ready → running →
succeeded | failed | timed_out`, with `denied`, `cancelling`, `cancelled`.
  Terminal states have no exits; a retry is a new attempt. Creation is
  idempotent per `(operator, idempotencyKey)`. EO-4.1 stores sessions in
  memory and exposes no API to create them.
- **ExecutionWorkspace** — `workspaceId`, `sessionId`, `projectId`, opaque
  `rootRef` (`workspace://<project>/<workspace>`), mode, status, quota.
- **Path safety** — `resolveWorkspacePath` rejects, under the union of Windows
  and POSIX rules: empty/control characters, `..` with any separator, POSIX
  absolute, drive letters and drive-relative paths, UNC, `\\?\`/`\\.\`
  device paths, rooted `\x`, `~`, `:` (NTFS streams), reserved device names,
  trailing dots/spaces, Windows-invalid characters; flag-like paths are refused
  where they become arguments. Symlinks/junctions cannot be judged from a
  string: providers must realpath and call `assertRealPathWithinRoot`
  (separator- and case-aware per platform).
- **Sandbox** — provider-neutral `SandboxProvider` (prepare workspace, start,
  invoke a `StructuredInvocation`, terminate, collect outputs, cleanup) with
  declared `enforcedLimits`, network modes and filesystem isolation. A sandbox
  is not an `EnvironmentInstance`: the environment says where compatible tools
  exist; the sandbox is the isolation boundary. No provider is registered.
- **Resource limits** — required `sessionTimeoutMs`, `operationTimeoutMs`
  (≤ session), `maxOutputBytes`, `maxArtifactBytes`, `maxToolCalls`; optional
  CPU, memory, processes, filesystem quota, model calls. Positive integers
  under hard ceilings. Each limit is reported `enforced` or `unsupported` for
  the selected provider — never claimed without enforcement.
- **Network policy** — `deny_all` by default, or `allow_approved_hosts` with
  exact lowercase HTTPS host names. IP literals, `localhost`, internal
  suffixes and cloud metadata names are rejected. Resolved-address/DNS
  rebinding enforcement is the provider's job and is not claimed.
- **SecretBroker** — `describe(ref)` and `issueHandle(ref, grant)` (opaque,
  grant-bound handle). The default `DenyAllSecretBroker` knows nothing.
- **Cancellation / kill switch** — `cancel-execution` (operators) and
  `kill-execution` (administrators only) Control Plane commands for ONE
  session. Idempotent and state-aware (`cancelled`, `cancelling`,
  `already_cancelled`, `already_cancelling`, `already_terminal`) and audited
  (`execution_event` + `control_command`). Not a shell kill; agents have no path to it.
- **ExecutionReceipt** — immutable evidence of one attempt: ids, exact plan
  reference, agent, environment, tool/operation, policy version, approvals,
  times, outcome, exit classification, artifact references (size, sha256,
  media type, producer session, storage ref), log references, resource
  summary, redaction status and an explicit `simulated` flag. Deep-frozen and
  append-only (`InMemoryExecutionReceiptStore`). Audit ≠ receipt: the audit log
  is governance history; a receipt is evidence of one attempt.
- **Output/logs** — `boundOutput` redacts known secret shapes and known values
  first, then truncates explicitly (`truncated`, `originalBytes`).

## API (EO-4.1)

| Route                                             | Capability                                    |
| ------------------------------------------------- | --------------------------------------------- |
| `POST /api/execution/preflight`                   | `prepare_execution` (operator, admin) + scope |
| `GET /api/execution/operations`                   | `view`                                        |
| `GET /api/execution/sessions/:sessionId`          | `view` + project scope (404 otherwise)        |
| `GET /api/projects/:projectId/execution-sessions` | `view` + project scope (404 otherwise)        |
| `POST /api/commands/cancel-execution`             | `cancel_execution` (operator, admin)          |
| `POST /api/commands/kill-execution`               | `kill_execution` (admin only)                 |

## Not in EO-4.1 (EO-4.2+)

Real sandbox providers, registered production operations and policies,
Firestore-backed session/receipt stores, a Secret Manager-backed broker,
network enforcement, and any activation of execution.

# Bounded Tool Execution (EO-4.2)

> **NO GENERAL-PURPOSE TERMINAL. NO RAW MODEL COMMAND EXECUTION.**
>
> **REGISTERED TOOL ≠ AUTHORIZED TOOL. AUTHORIZED TOOL ≠ AUTHORIZED OPERATION.**
>
> An invocation runs only when the operation is registered, permitted by the
> bound policy version, covered by a live capability grant, compatible with the
> environment, and the session is valid. There is no HTTP route for it; the
> normal caller is the orchestrator. Production registers no sandbox provider
> and no permitting policy, so nothing runs there.

## Pipeline

```
orchestrator → ExecutionManager.invoke({ sessionId, invocationId, toolId, operationId, input })
  validateInvocationRequest     unknown fields (command, executable, cwd, env, …) → 400
  session scope + state         ready|running only; other projects → 404
  registered tool + operation   ExecutionToolRegistry / ExecutionOperationRegistry (exact ids)
  every pre-flight gate again   exact plan revision, agent, environment, approval, policy,
                                structured input, workspace paths, sandbox
  capability grants             grantAllows() for every required capability (live, exact context)
  environment compatibility     tool environment capabilities + operation toolchains
  limits + concurrency          session budget, tool-call count, 1 active per session,
                                per-environment ceiling (denied, never unlimited)
  → ToolExecutionEngine         the existing bounded tool pipeline (agent/project/env,
                                permission system, call ceilings, tool_execution audit)
  → execution tool handler      opaque single-use invocation reference only
  → SandboxProvider.invoke      trusted executable + template argv, no shell
  → output validation           operation output schema (text / semver), redaction, bounds
  → receipt + execution_event audit; session → succeeded | failed | timed_out | cancelled
```

## Definitions

- **ExecutionToolDefinition** — `toolId` (identity), `version`, `displayName`,
  `description`, `requiredCapabilities`, `supportedEnvironmentCapabilities`,
  one server-controlled `executable` (argument templates per operation) and
  the exact `operations` it exposes. Registered only at trusted composition
  (`registerExecutionTool`), frozen; also registered in the existing
  `ToolRegistry` so every call goes through `ToolExecutionEngine`. A tool
  cannot grant itself capabilities.
- **ExecutionOperationDefinition** (extended) — input schema, `output` schema,
  `requiredToolchains`, `workspaceAccess`, `networkAccess`, `timeoutMs`, risk
  and required capabilities. Operations that need the network require the
  `network.outbound.allowed-host` capability and a policy that allows hosts; a
  tool can never widen the session network policy.
- **Initial allowlist** — `node.version` (tool `node`, argv `--version`,
  semver output, no workspace, no network). Nothing else is registered.
- **Argument policy** — argv comes only from the operation template: literals,
  enum values, bounded integers and validated workspace paths (flag-like paths
  refused). A model cannot add flags, executables or options.
- **Environment variables** — the child environment is constructed, never
  inherited: only names the executable declares, with values from trusted
  configuration. On Windows, libuv always adds a fixed non-secret system
  baseline (PATH, TEMP, USERNAME, USERPROFILE, …); no credential variable
  (API keys, Firebase/cloud credentials, tokens) is ever passed.

## Process adapter

`adapters/execution/bounded-process-runner.ts` is the only general process
adapter and is not exported. It accepts a trusted absolute executable path, an
argument vector, a provider-owned working directory, a complete environment, a
finite timeout, an output cap and an `AbortSignal`. It spawns with
`shell: false`, bounds stdout/stderr with explicit truncation, redacts known
secret shapes, and terminates the process tree on timeout or cancel (POSIX
process group; Windows `taskkill /T /F`).

`LocalHostDiagnosticsSandbox` is the first provider. It is honest: it does not
isolate the filesystem or network, so the registry selects it only when a
policy rule opts in (`hostProcess: true`) and the operation touches neither
workspace nor network. It runs in a fresh scratch directory that is removed
afterwards. Limits it cannot enforce (CPU, memory, processes, filesystem quota)
are reported `unsupported`.

## Timeouts, cancellation, limits

- Effective timeout = min(policy `operationTimeoutMs`, operation `timeoutMs`,
  remaining session budget). On timeout the tree is killed → `TIMEOUT`,
  attempt/session `timed_out`, receipt `timed_out`.
- `cancel-execution` / `kill-execution` on a running session move it to
  `cancelling` and abort the active invocation; it ends `cancelled`.
  Repeated cancels are idempotent.
- Output over `maxOutputBytes` is truncated (`truncated: true`, recorded on the
  receipt). The manager re-redacts and re-bounds provider output defensively.

## Receipts and audit

Every completed or denied invocation produces an immutable receipt (session,
attempt, invocation id, project, plan revision, agent, environment, tool,
operation, policy version, times, outcome, exit class, output metadata,
redaction status, `simulated` for test providers). Denials are receipted as
`denied` with reason codes (`TOOL_NOT_ALLOWED`, `CAPABILITY_NOT_GRANTED`,
`APPROVAL_REQUIRED`, `WORKSPACE_VIOLATION`, …) and are never reported as tool
failures. `execution_event` audit actions: `invocation_requested`,
`invocation_denied`, `operation_started`, `operation_completed`,
`operation_failed`, `operation_timed_out`, `operation_cancelled`,
`resource_violation`; the engine adds `tool_execution` events.

## Idempotency and concurrency

`(sessionId, invocationId)` is an idempotency key: a retry returns the stored
result (`replayed: true`) without running again; reusing a key for a different
call is refused. One active invocation per session, a per-environment ceiling
(default 2) and each provider's own ceiling — excess requests are denied
(`RESOURCE_LIMIT`), never queued unboundedly.

## Not in EO-4.2 (EO-4.3+)

Isolating providers (containers, runners), workspace-materializing operations,
builds/tests/installs, network-enabled operations, Firestore-backed
session/receipt stores, a Secret Manager-backed broker, orchestrator wiring
and any production activation.

# Isolated Workspaces & Repository Operations (EO-4.3)

> **WORKSPACE ≠ HOST FILESYSTEM · FILE WRITE ≠ FILE DELETE ·
> REPOSITORY WRITE ≠ GIT COMMIT · GIT COMMIT ≠ GIT PUSH · BUILD ≠ DEPLOY**
>
> Agents read and change project files only through registered operations,
> addressed by workspace-relative paths, inside the workspace bound to their
> session. There is no raw filesystem handle, no raw git, and no stage,
> commit, branch, fetch or push operation. Production composition is
> unchanged: no workspace provider is registered there.

## Components

- **WorkspaceRepositorySandbox** (`adapters/workspace/`) — the trusted
  workspace manager and `SandboxProvider` for executables `workspace`
  (in-process file operations) and `git` (read-only repository inspection).
  It is also the `WorkspaceControl` behind the ExecutionManager (ChangeSets,
  rollback, release). It is the only EO-4.3 code that touches the filesystem;
  git runs through the private EO-4.2 bounded process runner.
- **RepositoryReference** — trusted configuration per project: an attached
  `localPath` and/or a `remote` (https, no embedded credentials) with a
  `credentialRef` (`secret://…`). Remote acquisition needs a secret-broker
  handle and is not available in EO-4.3. Views, receipts and audit never
  contain host paths or credential references.
- **Workspace identity + lifecycle** — `workspaceId`, `projectId`,
  `sessionId`, `repositoryId`, `rootRef`, `mode`, `state`, `createdAt`,
  `leaseExpiresAt`, `baseRevision`. States: `preparing → ready ⇄ in_use →
dirty → cleaning → closed`, with `failed`; illegal transitions throw.
- **Persistent sessions** — a session created with `operationIds` covers
  several registered operations and stays `running` between invocations; it
  ends with `completeSession`, cancel/kill, or its time budget. Input is
  validated per invocation. The workspace is `read_write` only if one of the
  session's operations writes, so analysis/reviewer sessions stay read-only.

## Operations

| Operation                  | Capability                                         | Notes                                    |
| -------------------------- | -------------------------------------------------- | ---------------------------------------- |
| `workspace.file.read`      | `filesystem.read`                                  | size-limited; binary → metadata only     |
| `workspace.file.stat`      | `filesystem.read`                                  | type, size, class, hash                  |
| `workspace.file.list`      | `filesystem.read`                                  | one directory, paginated                 |
| `workspace.file.search`    | `filesystem.read`                                  | literal, bounded; skips secrets/.git     |
| `workspace.file.create`    | `filesystem.write.workspace`                       | never overwrites                         |
| `workspace.file.update`    | `filesystem.write.workspace`                       | requires matching `expectedHash`         |
| `workspace.file.delete`    | `filesystem.delete.workspace`                      | separate capability; `expectedHash`      |
| `workspace.file.move`      | `filesystem.write.workspace` + `.delete.workspace` | no overwrite; `expectedHash`             |
| `repository.status`        | `repository.read`                                  | structured porcelain                     |
| `repository.diff`          | `repository.read`                                  | bounded; secret files omitted; redacted  |
| `repository.log`           | `repository.read`                                  | `limit` 1–50, structured                 |
| `repository.currentBranch` | `repository.read`                                  |                                          |
| `repository.changedFiles`  | `repository.read`                                  | origin: preexisting / session / external |

Writes to **protected** paths (CI/CD, rules, infrastructure, deploy, auth,
lockfiles) additionally need `filesystem.write.protected`, an optional
capability granted only when the policy rule lists it. **Secret** files
(`.env*`, keys, credentials, `.ssh`, `secrets/`) are never readable or
writable. **Generated** output (`dist/`, `build/`, `node_modules/`, caches,
logs) is not source and is not written. `.git` internals are never reachable.
Classification is system policy (`WorkspaceFilePolicy`, per project); a
request cannot lower it. `.gitignore` is not used as a security boundary.

## Path and host isolation

Every path is canonicalized by `resolveWorkspacePath` (Windows + POSIX rules:
no `..`, absolute, drive, UNC, device, `~`, streams, reserved names), joined
under the configured root, and the realpath of the target — or of its nearest
existing ancestor for new files — must stay inside the root
(`assertRealPathWithinRoot`, case-insensitive on Windows). Symlinks,
junctions and reparse points that escape are refused; writes never go
through links. Another project's repository is simply not addressable.

## Git hardening

Repository operations use fixed argument templates, prefixed with
`--no-pager -c core.fsmonitor=false -c core.pager=cat -c diff.external=
-c credential.helper= -c protocol.allow=never -c color.ui=false`, and run
with `GIT_DIR`/`GIT_WORK_TREE` pinned to the workspace, a ceiling directory,
`GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null`, no terminal prompt and
no optional locks. Agents supply no flags; `limit` is a bounded integer.

## Baseline, conflicts, ChangeSet, rollback

- **Baseline** — on first use the adapter records the base revision and every
  path that already had uncommitted changes. Agents cannot overwrite those
  (`WORKSPACE_CONFLICT`): pre-existing user changes are never assumed to
  belong to AI Workforce.
- **Conflicts** — `create` never overwrites, `update`/`delete`/`move` require
  the current SHA-256 (`expectedHash`), so lost updates fail instead of
  silently overwriting.
- **Atomic writes** — temp file in the target directory, then rename, with
  containment re-checked.
- **ChangeSet** — per session: `created` / `modified` / `deleted` / `renamed`
  entries with before/after hashes, size deltas and risk (no content). It is
  not a commit; on completion it becomes `ready_for_review`.
- **Rollback** — `rollbackWorkspace` (operators) reverts only this session's
  mutations from session-owned backups, and only where the file still holds
  what the session wrote; anything changed by someone else is skipped.
  Never a global reset.

## Concurrency, cleanup, recovery

One exclusive, expiring write lease per repository root (readers are not
blocked); a second write session gets `WORKSPACE_CONFLICT` until the first
completes, is cancelled, or its lease expires (crashed sessions cannot lock a
project forever). Cleanup releases the lease and deletes only the adapter's
own state directory after proving ownership (direct child of the state root +
matching marker); otherwise it fails closed and reports why. The attached
working tree is never deleted.

## Audit and receipts

`execution_event` actions: `workspace_created`, `file_created`,
`file_modified`, `file_deleted`, `file_renamed`, `changeset_updated`,
`protected_operation_denied`, `repository_inspected`, `rollback_requested`,
`rollback_completed`, `workspace_closed`, `workspace_released`,
`workspace_lease_reclaimed`. Receipts carry `workspaceId`, `changeSetId` and
change evidence (paths, hashes, sizes) — never file content.

## Not in EO-4.3

Git stage/commit/push, branch management, remote acquisition (clone/fetch via
a secret broker), OS-level sandboxes, builds/tests, artifact management
(EO-4.4), and any production activation.

# Controlled Build, Test & Verification (EO-4.4)

> BUILD/TEST EXECUTION IS BOUNDED · NO GENERAL-PURPOSE TERMINAL ·
> VERIFIED ≠ COMMITTED ≠ PUSHED ≠ DEPLOYED

A verification runs the build, test and security stages that an **exact**
ExecutionPlan revision already contains. Each stage runs one **registered**
operation, mapped by a trusted per-project `VerificationProfile`. Every stage
is an ordinary EO-4.1–4.3 execution session, so it gets pre-flight, policy,
agent and environment revalidation, sandbox selection, limits, receipts and
audit. Deployment stages are never run.

## Components

| Component                                   | Layer          | Role                                                                                                      |
| ------------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------- |
| `contracts/verification.ts`                 | contracts      | StageRun, VerificationResult, VerificationProfile (+ validation), ArtifactRecord, SourceFingerprint       |
| `VerificationService`                       | core           | DAG validation, scheduling, fail-fast, retries, fingerprints, ChangeSet status, immutable history, cancel |
| `ArtifactManager`                           | core           | SHA-256 digests, integrity re-check, size limit, project-scoped immutable records                         |
| `defineBuildTool` / `BUILD_PROFILE_PRESETS` | core           | Fixed-argv build/test tools; presets for dotnet, gradle, xcode, unity, unreal (data only, not registered) |
| `workspace.security.secretScan`             | core + adapter | In-process secret scan; reports path, line and rule, never the value                                      |
| `WorkspaceBuildRunner`                      | adapters       | Runs one trusted executable with fixed argv in the leased workspace root                                  |

## No terminal, no arbitrary scripts

- Build/test operations accept **no input**. Their argv is fixed by trusted
  composition, so an agent cannot reach argv, and `npm run <string>` does not exist.
- `defineBuildTool` refuses:
  - shells and interpreters: sh, bash, cmd, powershell, pwsh, npx, and similar;
  - eval flags: `-e`, `--eval`, `-c`, `-Command`, and similar;
  - install, restore, publish, deploy, push, exec and dlx arguments.
- Dependencies are never installed. An operation declares `requiredPaths`, and
  if one is missing the stage fails with `DEPENDENCY_MISSING`.
- The environment is revalidated for every stage. A missing toolchain on the
  selected instance fails with `TOOLCHAIN_UNAVAILABLE`, which is reported
  separately from `ENVIRONMENT_UNAVAILABLE`.

## Host build risk (explicit opt-in)

Build and test operations are `executionClass: "project_code"`, meaning they
run the project's own code.

`WorkspaceBuildRunner` honestly reports `filesystemIsolation: false` and
`networkIsolation: false`. The sandbox registry selects it only when all of
these hold:

- the policy rule sets `trustedHostBuild: true`, a per-project risk acceptance
  for trusted repositories only;
- the provider declares `workspaceExecution`;
- the operation requests no network.

Otherwise the stage is blocked with `SANDBOX_UNAVAILABLE`. Each verification
records the isolation it actually had, taken from its least isolated stage.
OS-level isolation (containers or VMs) is future work. Until it exists, do not
enable `trustedHostBuild` for untrusted code.

## Scheduling

- **Dependencies:**
  - Plan test dependencies are combined with the profile's `dependsOn`.
  - Unknown stage ids and cycles throw `ValidationError` before anything runs.
- **Blocked dependents:**
  - A stage whose dependency did not pass is `not_run` with `BLOCKED_BY_DEPENDENCY`.
  - An unmapped planned stage is `not_run` with `NO_PROFILE` and is listed in
    `unverifiedStageIds`. It is never reported as passed.
- **Parallelism:**
  - Parallelism is bounded by `maxParallel`, from 1 to 4.
  - Write stages hold the workspace exclusively.
  - One verification runs per project by default.
- **Fail-fast:** `failFast` stops new stages after a required failure; they
  are marked `FAIL_FAST`. The continue policy runs independent stages.
- **Timeouts:** timeouts are per operation and bounded by policy. The process
  tree is killed on timeout and on cancel.
- **Retries:**
  - Only **transient** execution errors are retried (sandbox failure or
    resource limit), up to `maxAttempts`, from 1 to 3.
  - A failing build or test is a result and is never retried.
- **Failure kinds** stay distinct:
  - `BUILD_FAILED`, `TEST_FAILED`, `FINDINGS`;
  - `TIMEOUT`, `CANCELLED`;
  - `EXECUTION_ERROR`;
  - `POLICY_DENIED`, `SANDBOX_UNAVAILABLE`, and the toolchain, environment
    and dependency kinds.

## Evidence

- **Source fingerprint:** a SHA-256 of the base revision plus the hashes of
  every changed or untracked source file. Generated and secret files are
  excluded. It is taken before and after the stages run; if they differ, the
  verification fails with `SOURCE_CHANGED`.
- **ChangeSet correlation:**
  - The author's session must be completed first.
  - The ChangeSet moves from `verifying` to `verified` or `verification_failed`.
  - `verified` is not a commit, and nothing is staged, committed or pushed.
- **Artifacts:**
  - Stored with workspace-relative path, size, SHA-256, source fingerprint
    and ChangeSet.
  - Size is limited, and secret or internal files are refused.
  - Integrity can be re-verified at any time.
  - Records are project-scoped and immutable.
- **Logs:**
  - Output is bounded and redacted before storage, and truncation is explicit.
  - Secret-scan evidence contains rules and counts, never values.
- **Results:**
  - Terminal results are deep-frozen.
  - History is immutable and project-scoped. An invisible project returns 404.
- **Authorization:**
  - Starting needs `prepare_execution`, cancelling needs `cancel_execution`,
    and reading needs `view`.

## Not in EO-4.4

- Control Plane routes and UI for verifications (the service is not yet exposed).
- OS-level isolated build providers.
- Remote repository acquisition.
- Dependency restore.
- Commit, push, PR and deployment (never autonomous).

# Environment Execution Adapters & Cross-Platform Runners (EO-4.5)

> IDE ≠ TOOLCHAIN · ENVIRONMENT ≠ ADAPTER · ADAPTER ≠ RUNNER ·
> RUNNER ≠ SANDBOX · DISCOVERED ≠ EXECUTION READY · BUILD ≠ SIGN ·
> BUILD ≠ PUBLISH · NO GENERAL-PURPOSE TERMINAL

```text
Control Plane → ExecutionManager → EnvironmentAdapterRegistry → Adapter
  → Runner (exposed as a routed SandboxProvider) → bounded operation
  → receipts (environment evidence) + audit
```

## Concepts

| Concept                                     | What it is                                                                             | Where                                                                             |
| ------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| EnvironmentDescriptor / EnvironmentInstance | What discovery (EO-2) says exists                                                      | `contracts/environments.ts`                                                       |
| `EnvironmentExecutionAdapter`               | Knows one family; pure `evaluate(instance, host, requirement)`                         | `contracts/environment-adapters.ts`, `adapters/environments/platform-adapters.ts` |
| `EnvironmentAdapterRegistry`                | Trusted registration, deterministic resolution, leases, stage routing, status          | `core/execution/environment-adapters.ts`                                          |
| `ExecutionRunner`                           | Performs bounded execution for a family; heartbeat, health, prepare/run/cancel/release | contract + `HostProcessRunner`                                                    |
| Sandbox                                     | The isolation the runner declares (`sandbox.filesystemIsolation` / `networkIsolation`) | runner descriptor                                                                 |

- **Families:** `windows`, `macos`, `android`, `linux`, `docker`, `cloud`,
  `unity`, `unreal`.
- **IDEs are not families.** Visual Studio, VS Code and Android Studio
  projects route to the underlying toolchain (.NET SDK/MSBuild, Node,
  JDK + Gradle + Android SDK, Xcode). EO-4.5 adds no IDE or GUI automation.

## Resolution (execution readiness)

A registered operation may declare `environment:
EnvironmentOperationRequirement`, covering:

- family;
- toolchains with minimum versions and components;
- exact engine versions;
- targets or modules;
- GPU;
- container request;
- signing and publishing, which are always refused in EO-4.5.

For such operations, the ExecutionManager asks the registry before selecting a
sandbox. The registry checks these in order:

1. An adapter is registered for the family (`ADAPTER_UNAVAILABLE` otherwise).
2. The instance and its host are available (`ENVIRONMENT_OFFLINE`).
3. The adapter accepts the instance. This covers:
   - platform (`PLATFORM_MISMATCH`), e.g. Xcode needs a macOS host, whatever
     the label says;
   - toolchains (`TOOLCHAIN_MISSING`, `TOOLCHAIN_VERSION_MISMATCH`);
   - modules and SDKs proven by discovery (`MODULE_MISSING`);
   - GPU (`GPU_UNAVAILABLE`);
   - container policy (`CONTAINER_POLICY_DENIED`);
   - `SIGNING_NOT_AUTHORIZED` and `PUBLISHING_NOT_AUTHORIZED`.
4. The executable is one the adapter serves.
5. A runner is eligible. Runners are sorted by id, and a runner is rejected
   for any of:
   - unverified identity (`RUNNER_IDENTITY_UNVERIFIED`);
   - a project restriction or project runner policy, such as trusted-only,
     runner class, or region (`POLICY_DENIED`);
   - a missing or stale heartbeat, or an offline or draining status
     (`RUNNER_UNAVAILABLE`);
   - no free capacity (`RESOURCE_UNAVAILABLE`).

The selected runner's provider is **pinned** into sandbox selection.

- Runner providers are `requiresRouting` and never chosen implicitly.
- An invocation whose routing now points elsewhere is denied
  (`RUNNER_UNAVAILABLE`, "re-routing requires a new session").
- **No silent failover:** a new session re-evaluates policy, approval and
  routing, and both routing decisions are audited.
- Resolution is deterministic for identical inputs.

`routeStages` assigns each stage of a multi-environment project, for example
web to Linux, backend to Windows/.NET, iOS to macOS/Xcode, Android to an
Android runner, and 3D to Unity. Instances are tried in id order. A stage with
no ready instance keeps the closest candidate's reasons.

## Runner lifecycle and leases

- **Heartbeat statuses:** online, busy, draining, offline and stale. A heartbeat
  older than `staleAfterMs` is stale.
- **Health check:** a bounded readiness probe with a timeout. It never
  performs arbitrary execution.
- **Leases:** start acquires a bounded, expiring lease within runner capacity,
  and cleanup releases it. Expired leases are reclaimed and audited, so there
  are no permanent locks.
- **Timeouts:** each operation is bounded by its timeout plus a short grace
  period, then cancelled (`RUNNER_TIMEOUT`).
- **Cancel and kill:** the manager's abort signal propagates to
  `runner.cancel`.
- **Disconnect:** a heartbeat lost mid-operation gives `sandbox_failure` with
  `RUNNER_DISCONNECTED`. The session fails and never reports success.
- **Credentials:**
  - A runner descriptor carries only a `credentialRef` (`secret://…`).
  - The value is resolved server-side by a `RunnerCredentialResolver` at
    `start`, passed only to `runner.run`, and scrubbed from outputs.
  - It never appears in plans, the API, receipts or audit.
  - Descriptors may not contain endpoint URLs; runners are identified, never
    addressed.

## Platform adapters

| Adapter             | Family  | Requires                                                                                        |
| ------------------- | ------- | ----------------------------------------------------------------------------------------------- |
| `windows-toolchain` | windows | Windows host; .NET SDK / MSBuild / Node (no cmd/PowerShell)                                     |
| `macos-xcode`       | macos   | macOS host; Xcode; Apple targets proven by `*_sdk` components or discovery                      |
| `android-gradle`    | android | JDK + Gradle + Android SDK                                                                      |
| `linux-toolchain`   | linux   | Linux host; Node/Python/Go/Rust/C++                                                             |
| `docker-container`  | docker  | Container runtime discovered and daemon `operational`, plus the container policy                |
| `cloud-runner`      | cloud   | A registered `cloud_runner` host and a verified runner identity; provider-neutral               |
| `unity-editor`      | unity   | Pinned editor version (exact) and discovered target modules                                     |
| `unreal-engine`     | unreal  | Pinned engine version, a C++ compiler and discovered platform SDKs; projects are never migrated |

**Container policy (deny by default):**

- Never granted: privileged mode, host network, host PID, the Docker socket,
  and devices.
- Mount sources are symbolic (`workspace` or `artifacts`); sensitive targets
  such as `/`, `/proc`, `/sys`, `/dev`, `/etc` and `/var/run` are refused.
- Images must be approved, versioned and digest-pinned when policy requires it.

## Real runner vs. contract

- **`HostProcessRunner` is the only real runner in EO-4.5.**
  - It runs a trusted absolute executable with fixed argv through the EO-4.2
    bounded process runner: no shell, a constructed environment, output caps,
    redaction and process-tree kill.
  - It declares no filesystem or network isolation, so EO-4.2/4.4 selection
    rules still apply.
  - It is verified on the Windows development host (`node --version` through
    the Windows adapter).
- **All other families have adapters (contracts) only.** They are tested with
  the `FakeRunner` test double (`simulated: true`).
- `registry.status()` reports a family as `available` only for **real**
  runners. Simulated-only or runner-less families are `not_configured`, and
  families without an adapter are `unsupported`.

## Evidence

- **Receipts and invocation results** carry `environment`:
  - instance, adapter id and version;
  - runner id, identity and class;
  - toolchain versions;
  - the source fingerprint the runner executed;
  - whether the runner was simulated.
- **Verification stages** record the same evidence. A runner that executed a
  different source fingerprint fails the stage with `SOURCE_CHANGED`.
- **Artifact handoff:** `ArtifactHandoffService` moves only declared
  `ArtifactRecord`s between runners.
  - It checks project scope and the expected source fingerprint
    (`SOURCE_MISMATCH`), and the SHA-256 on both read and write
    (`INTEGRITY_FAILED`).
  - Transfers are size-limited and audited.
- **Audited events:**
  - adapter selection, runner rejection;
  - lease acquire, release and expiry;
  - execution start, completion and failure;
  - disconnect;
  - handoff completion and rejection.

## Not in EO-4.5

- Real macOS, Android, Docker, cloud, Unity and Unreal runners (contracts only).
- Control Plane routes and UI for environment execution status.
- Remote runner transport.
- A queue for waiting on capacity (`RESOURCE_UNAVAILABLE` is returned instead).
- Signing, publishing, and IDE/GUI automation.

# Governed Source Control & Deployment (EO-4.6)

> WRITE ≠ STAGE ≠ COMMIT ≠ PUSH ≠ DEPLOY · DEPLOYED ≠ HEALTHY ·
> REVIEW ≠ APPROVAL · BUILD ≠ SIGN ≠ PUBLISH · FORCE PUSH: DENIED

```text
ChangeSet → Verification (EO-4.4) → Review → StageSet → Commit approval → Commit
  → Push approval → Push (fast-forward only) → DeploymentCandidate
  → Deploy approval (per target class) → Deploy → Post-deploy verification
  → ReleaseReceipt / Rollback → Audit
```

Every arrow is a separate command with its own authorization:

| Step     | Capability                             |
| -------- | -------------------------------------- |
| Review   | `review_change` (operators and admins) |
| Commit   | `commit_source` (admins)               |
| Push     | `push_source` (admins)                 |
| Deploy   | `deploy_release` (admins)              |
| Rollback | `rollback_release` (admins)            |

## SourceControlOrchestrator (`core/release/`)

- **Review (`ReviewRecord`)**
  - A review is bound to one verification and its source fingerprint.
  - With `requireIndependentReview`, neither the authoring agent nor the
    requesting operator may review their own change (`REVIEW_NOT_INDEPENDENT`).
  - A review is not an approval.
- **StageSet**
  - Contains exactly the files of the reviewed, verified ChangeSet.
  - Secret, internal and generated files are excluded and listed as such.
  - Pre-existing, unrelated changes are never included.
  - It is created only if the **current** source fingerprint equals the
    verified one; otherwise the result is `REVERIFICATION_REQUIRED`.
- **Commit**
  - Every gate is re-checked: verification, review, source fingerprint, the
    bound commit approval, and an unchanged HEAD.
  - The message is built by the system: a sanitized one-line summary plus
    `AI-Workforce-*` trailers for project, plan, ChangeSet, verification,
    review and session. A summary cannot inject lines or forge trailers.
  - The commit author is the configured automation identity.
  - The resulting commit is verified to contain exactly the stage set;
    otherwise it is never pushed.
  - The operation is idempotent per operator and key.
- **Push**
  - Branch policy decides the destination. A branch in `directPushBranches`
    is pushed directly. A protected or default branch goes to a working
    branch `aiw/<changeSetId>`, and a pull request is opened through the
    `PullRequestPort`. Remote CI checks are shown as `unknown` until the
    provider reports them.
  - Requires its own bound push approval.
  - The remote branch must equal the commit's parent (or be absent);
    otherwise the result is `REMOTE_CHANGED` and nothing is overwritten.
  - **The push is fast-forward only. There is no force option anywhere.**
- **Receipts:** `CommitReceipt` and `PushReceipt` record:
  - SHA, branch, remote id, expected remote SHA;
  - ChangeSet, source fingerprint, verification, review and approvals;
  - policy version, actor and time.
  - They never contain credentials.

## GovernedGitAdapter (`adapters/workspace/`)

- **The only component that mutates a repository.**
- It uses fixed, hardened argument templates:
  - hooks, fsmonitor, pagers, external diff and credential helpers are off;
  - every transport except the configured remote's scheme is off.
- Callers pass a `projectId` and typed data. They cannot pass git arguments,
  a remote URL, a refspec or a force flag.
- Remotes come from trusted configuration: https (no embedded credentials) or
  an absolute local path.
- Credentials are sent as an HTTP header through the child process's
  configuration environment. They never appear in argv, and they are redacted
  from output.

## Approval binding

`requestBoundApproval` stores a canonical binding in the approval's metadata:
action, project, subject, source fingerprint, commit, branch and target.

- Operators decide the approval in the existing Approvals flow.
- `checkBoundApproval` accepts only an approved, unexpired approval whose
  binding matches exactly.
- A commit approval never authorizes a push, and a push approval never
  authorizes a production deploy.
- A stale approval, bound to an old source, does not authorize changed source.

## DeploymentOrchestrator

- **Targets** are registered by trusted composition. Each has:
  - a project and a target class (development, preview, staging, production);
  - an adapter and scoped resources, e.g. `["hosting"]`;
  - a trusted provider reference, a credential reference and a timeout.
- **Requests name a `targetId` only.** An unknown target and another project's
  target are indistinguishable (`TARGET_NOT_REGISTERED`).
- **DeploymentCandidate:** an immutable record of commit, source fingerprint,
  verification, review, artifact digests, target and policy version.
  - It is `STALE_CANDIDATE` if the verification no longer passes for that
    source or if the release policy version changed.
- **Release policy:** each target class has its own requirements:
  - review, approval, post-deploy verification, rollback plan;
  - automatic rollback (off by default) and rollback approval.
  - Production requires a deploy approval bound to exactly that candidate and
    target.
- **Deployment lock:** one expiring lock lease per target, so concurrent
  deploys to the same target fail with `DEPLOYMENT_LOCKED`.
- **Timeouts:** every provider call is time-bounded.
- **Release states:** `pending → deploying → deployed → verifying →
healthy | degraded | failed → rolled_back`.
  - **HEALTHY** requires the target to be reachable **and** to report the
    candidate's commit as its version.
  - A provider "success" alone is only `deployed`.
- **Rollback:**
  - Restores the last **known healthy** release on the same target through
    `adapter.rollback`; it is never "redeploy latest".
  - It is itself approved and audited.
- **ReleaseReceipt:**
  - candidate, commit, artifact digests, target and class;
  - adapter and version, provider release id, approvals, policy version;
  - status, reasons, post-deploy evidence and rollback;
  - duration (never a cost) and a `simulated` flag.

**Adapters in this release:**

- `DeploymentAdapter` is the provider contract.
- Tests use a deterministic, test-only adapter (`simulated: true`).
- **No production deployment provider is configured by EO-4.6.** Firebase,
  container, mobile, desktop and game distribution are future adapters that
  keep build, sign, upload and publish as separate steps.

# Execution Control Center (EO-4.7)

The **Operations** tab on a project (`/projects/:id/operations[/:sessionId]`)
is the operator's view of execution. It reads only through the Control Plane.

| Route                                                                      | Returns                                                                                                                       |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/projects/:id/execution-overview`                                 | Real counts per status; verification/release counts or `configured: false`                                                    |
| `GET /api/projects/:id/executions?status&limit&offset`                     | Project-scoped sessions, newest first, page size ≤ 100                                                                        |
| `GET /api/projects/:id/executions/:sessionId?timelineLimit&timelineOffset` | Session, agent, model (separate), environment + runner, workspace, ChangeSet, verifications, receipts, audit timeline (≤ 200) |
| `GET /api/projects/:id/verifications`                                      | Verification history with `sourceCurrent` (reverification required when false)                                                |
| `GET /api/projects/:id/releases`                                           | Reviews, stage sets, commits, pushes, PRs, release receipts, targets (no credential refs)                                     |
| `GET /api/execution/environments`                                          | EO-4.5 family status (only real runners make a family available)                                                              |

**Security:**

- **Reads are project-scoped on the server.** A session id under another
  project returns **404**.
- **Authentication:** a missing token or a pending account returns **401**.
- **Authorization:** missing capabilities return **403**.

**Mutations are only the existing typed, audited commands:**

- `cancel-execution` for operators;
- `kill-execution`, the emergency stop of **one** session, for administrators.

Both need a reason and a confirmation dialog, and the UI always re-reads state
afterwards. A 409 is shown as a conflict. There is no execute, shell or deploy
endpoint, and the UI never sends a command string, a destination or a
credential.

**What the UI shows:**

- **Pipeline:** Plan, Prepare, Execute, Verify, Review, Approve, Commit, Push,
  Deploy, Verify release. Each step is derived from evidence only; missing
  evidence shows as pending or not applicable. Pushed is never shown as
  deployed, and deployed is never shown as healthy.
- **Production:** marked with the text `PRODUCTION` and an icon, not by colour
  alone.
- **Redaction:** free-form audit data and reasons are redacted on the server.
  The UI also masks known secret shapes as defence in depth.
- **Polling:** only while something is live (every 15 s), and it stops
  automatically.

**Production today:**

- The Control Plane registers the EO-4.5 adapter **contracts** without runners
  (every family is `not_configured`) and an execution receipt store.
- EO-4.1's deny-all policy is unchanged, so nothing executes.
- Verification, source control and deployments are not configured in
  production, and the UI says so.

# Durable Execution State (EO-4.8)

Execution state is written to Firestore by the Control Plane (Admin SDK)
only. Client rules stay deny-all, and the browser still reads everything
through the Control Plane API.

| Collection                                       | Contents                                                                                                                                                                | Semantics                                                                                                                                                     |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `execution_sessions/{sha256(sessionId)}`         | Execution sessions                                                                                                                                                      | Read from Firestore on every access; every update is a **transaction** comparing the stored revision (CAS) — two instances can never both win a transition    |
| `execution_session_keys/{sha256(operator, key)}` | Idempotency key → session                                                                                                                                               | Created atomically with the session; a retried `createSession` replays after restarts                                                                         |
| `execution_records/{sha256(recordId)}`           | Receipts, verification results, reviews, stage sets, commit/push receipts, pull requests, deployment candidates, releases, idempotency reservations, uniqueness markers | Evidence is **create-only**; releases advance with `put`; lookups are single-field equality queries (`projectId`, `sessionId`), newest first, bounded (≤ 500) |

Each document stores a few index fields plus a JSON payload. This keeps
Firestore type limits (undefined values, nested arrays) from corrupting
evidence.

## Guarantees

- **Nothing reported that isn't stored.** Every write is awaited before a
  command returns: a receipt before `invoke` returns, a verification before
  `wait` resolves, a commit, push or release before its command returns.
  - If a receipt cannot be written after an execution already happened, this
    is recorded as a `receipt_persistence_failed` audit event, never hidden.
- **Idempotency holds across instances.** Commit, push and deploy take a
  create-only reservation before the mutation.
  - A second instance with the same key is refused while the first is in
    progress, and replays the original result once it is done.
  - A failed request can be retried; an abandoned reservation expires after
    10 minutes.
- **Uniqueness:** one commit per stage set is enforced by a create-only
  marker, taken only after every gate has passed.
- **Restart survival:** verification history, release history and the
  evidence behind commits and candidates survive restarts
  (`VerificationService.load/listHistory`, `DurableLedger`), and rollback
  finds the last healthy release from durable history.
- **Flush before response:** the Functions adapter releases a response only
  after pending cached-repository writes (audit, approvals, tasks) are
  flushed, bounded to 5 s, so a frozen serverless instance cannot drop them.

## Production

- `ExecutionManager` uses `FirestoreExecutionSessionStore` and writes
  receipts to `FirestoreExecutionRecordStore`.
- The Control Center reads receipts from Firestore.
- Verification, source control and deployments accept the same `store` and
  become durable as soon as they are composed. They are not composed in
  production yet.

## Known follow-up

`functions/index.ts` builds a new Control Plane runtime for every request
(the handler is not memoized). It is correct but slow. Memoizing it would make
the hydrate-once cached repositories stale across the two Function instances,
so it needs its own change: either move those collections to read-through
stores, or accept the staleness explicitly.

# EO-4 Production Release Gate (EO-4.8)

The complete threat model (threat → control → proving test), the
failure-recovery model, platform honesty matrix and accepted residual risks
are in [security/eo4-threat-model.md](security/eo4-threat-model.md). The
attack and failure-injection suite is `tests/eo48-security-gate.test.ts`.
