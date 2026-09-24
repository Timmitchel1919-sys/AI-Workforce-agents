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
