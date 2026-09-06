# Extension Guidelines

The foundation is meant to be extended only at its seams. These rules keep it
testable, isolated, and provider-agnostic.

## Golden rules

1. **`core/` never imports `adapters/` or a vendor SDK.** Dependencies flow
   `core → contracts` and `adapters → contracts` only. Wire concrete
   implementations together at the application entry point and inject them.
2. **Every external capability goes behind a contract.** If it talks to a
   network, a filesystem, a database, a shell, or a paid API, it is an adapter
   that implements an interface from [`contracts/index.ts`](../contracts/index.ts).
3. **Deny by default.** New actions start with no permission. Add the narrowest
   `PermissionGrant` that makes the feature work, plus explicit `deny` grants
   for dangerous combinations.
4. **No unrestricted access.** Do not add a "run any shell command" or "read any
   file" tool. Tools are named, individually reviewed operations.
5. **Add deterministic tests with every change.** No test may perform a real AI
   API call or depend on wall-clock timing or network access.
6. **Keep it a modular monolith.** No microservices, no message brokers, no new
   runtime dependency unless it is clearly load-bearing and reviewed.

## Adding a model provider (e.g. OpenAI, Google)

The Anthropic adapter (`adapters/models/anthropic-model-provider.ts`) is the
reference. Follow its shape:

1. Create `adapters/models/<vendor>-model-provider.ts` — the **only** module
   allowed to import that vendor's SDK.
2. `implements ModelProvider` — `readonly id` and `generate(request)`.
3. **Config:** a `load<Vendor>Config(input?, env?)` that resolves the API key
   (required) and options from an explicit object → env vars → defaults, and
   throws `ProviderConfigError` (secret-free message) on missing/invalid values.
   Never hard-code a key, commit a key, or put one in a fixture. Expose a
   `describe()` that returns config **without the key**.
4. **Transport seam:** define a local `<Vendor>Transport` interface for just the
   call you make. The real transport should **lazily `import()`** the SDK (clear
   `ProviderConfigError` if absent). Type your adapter against local interfaces,
   not SDK types, so `tsc` does not require the SDK. Add the SDK as an
   **optional `peerDependency`** (+ `devDependencies` for CI).
5. **Mapping:** `ModelRequest.messages` → vendor format; vendor reply →
   `ModelResponse` (`content`, `model`, optional `usage`). Raise
   `ProviderResponseError` for a reply you cannot interpret.
6. **Errors:** a `map<Vendor>Error(error, apiKey)` that returns the
   provider-neutral classes from `contracts/` (`ProviderAuthError`,
   `ProviderRateLimitError`, `ProviderTimeoutError`,
   `ProviderUnavailableError`, `ProviderRequestError`, else `ProviderError`),
   with `status` / `retryable` set and every message passed through
   `redactSecrets(msg, [apiKey])`.
7. **Register:** export a `<vendor>Factory(config, options)` and register it on
   `ModelProviderRegistry` from the wiring layer — do **not** import the adapter
   from `core/`.
8. **Audit:** wrap the provider in `AuditedModelProvider` at wiring time. Leave
   `logContent` off unless retaining prompt/response text is intended and safe.
9. **Tests:** stub the transport. Cover config/validation, request+response
   mapping, every failure class, and secret redaction. Never call the real
   endpoint.

## Adding a tool provider

1. Create `adapters/tools/<name>-tool-provider.ts` implementing `ToolProvider`.
2. Expose an explicit `tools` list. `execute` must reject any tool not on it.
3. Gate side-effecting tools through `PermissionSystem.assert(...)` at the call
   site, and route human-gated actions through `ApprovalSystem`.
4. Never expose raw shell, arbitrary filesystem, or credential retrieval.

## Adding a project adapter (AIMS, Money Mind, Mastery, Tripod)

1. Create `adapters/projects/<project>-adapter.ts` extending `BaseProjectAdapter`.
2. Set a stable `projectId` and a `displayName`.
3. Declare each supported operation in `operations`: a `ProjectCapability`
   (`operation`, `description`, `action`) plus a `handler`.
4. The handler calls the project's **own API or CLI**. Do not copy the
   project's source into this repository.
5. Keep project data flowing only through `ContextSystem` scoped to that
   project's id.

## Adding an audit sink

Implement `AuditSink.write(event)` and pass it to `new AuditLog(sink)`. Keep the
default `InMemoryAuditSink` working for tests. External log shipping is a later
decision.

## Adding a persistence backend

1. Implement `Repository<T>` from
   [`contracts/persistence.ts`](../contracts/persistence.ts) —
   `upsert` / `findById` / `list` / `delete` / `clear`, synchronous, storing a
   defensive copy on write and returning one on read.
2. Bundle one repository per collection into a `PersistenceProvider` (tasks,
   agents, approvals, handoffs, audit events).
3. Anything touching `node:fs`, a network, or a database driver is an
   **adapter** (`adapters/persistence/…`). Only the pure in-memory default
   lives in `core/`.
4. Never persist a secret. Persisted entities carry no credentials; keep it
   that way.
5. Add tests that prove state survives a fresh instance over the same store
   (see `tests/persistence.test.ts`).
6. A networked store that must be async needs a new interface revision — write
   an ADR first (see [ADR-0002](adr/0002-local-json-file-persistence.md)).

## Adding an approval policy

Implement `ApprovalPolicy.evaluate(task): ApprovalRequirement` and pass it in
`OrchestratorOptions.approvalPolicy`. It must be deterministic and **must not
auto-approve** — it only decides whether a human decision is required. The
human decision arrives separately via `orchestrator.recordApprovalDecision(...)`
followed by `orchestrator.resume(...)`.

## Declaring the permissions a task needs

Set `requiredPermissions` on the `TaskDraft` (`{ action, toolId? }` entries).
The orchestrator asserts each against the injected `PermissionSystem` before
dispatch and fails the task on denial. A task with `requiredPermissions` and no
`PermissionSystem` configured fails safe.

## Changing the task or handoff state machine

Edit the transition table in
[`core/tasks/task-system.ts`](../core/tasks/task-system.ts) (or the handoff
status checks) and update the lifecycle diagram in
[`architecture.md`](architecture.md). Add tests for both the new valid path and
a representative invalid one.

## Checklist before committing

- [ ] `npm run check` passes (typecheck + lint + format:check + test)
- [ ] All tests deterministic and offline — no real AI API calls
- [ ] No secret, API key, token, or credential in code, tests, fixtures, or
      persistence
- [ ] `core/` still has zero imports from `adapters/`
- [ ] New external capability (provider, tool, project, persistence) sits behind
      a contract
- [ ] New actions are deny-by-default with least-privilege grants
- [ ] Docs updated (this file, `architecture.md`, and an ADR for a structural change)
