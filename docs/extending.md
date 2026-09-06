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

## Adding a model provider (e.g. OpenAI, Anthropic, Google)

1. Create `adapters/models/<vendor>-model-provider.ts`.
2. `implements ModelProvider` — a `readonly id` and `generate(request)`.
3. Read the API key from the environment at call time. **Never** hard-code a
   key, commit a key, or add a key to a fixture.
4. Map `ModelRequest.messages` to the vendor format and map the response back to
   `ModelResponse` (`content`, `model`, optional `usage`).
5. Add a test that uses a stubbed transport — not the real endpoint.

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

## Changing the task or handoff state machine

Edit the transition table in
[`core/tasks/task-system.ts`](../core/tasks/task-system.ts) (or the handoff
status checks) and update the lifecycle diagram in
[`architecture.md`](architecture.md). Add tests for both the new valid path and
a representative invalid one.

## Checklist before committing

- [ ] `npm run typecheck` passes
- [ ] `npm test` passes (all deterministic, offline)
- [ ] No secret, API key, token, or credential in code, tests, or fixtures
- [ ] `core/` still has zero imports from `adapters/`
- [ ] New external capability sits behind a contract
- [ ] New actions are deny-by-default with least-privilege grants
- [ ] Docs updated (this file, `architecture.md`, and an ADR for a structural change)
