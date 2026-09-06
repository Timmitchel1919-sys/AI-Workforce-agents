# ADR-0004: Model provider layer + Anthropic adapter

**Status:** Accepted
**Date:** 2026-09-06
**Related:** [ADR-0001](0001-modular-provider-agnostic-workforce.md),
[ADR-0002](0002-local-json-file-persistence.md)

## Context

Phase 2B adds the first real AI model provider (Anthropic) while keeping the
Workforce core provider-agnostic. The core must not import the Anthropic SDK,
know its request/response shapes, or handle its error types. It also needs
structured audit around model calls and a way for future providers (OpenAI,
Google, ...) to plug in without core changes.

## Decisions

### 1. The Anthropic SDK is an optional peer dependency

`@anthropic-ai/sdk` is declared as an **optional `peerDependency`** (and kept in
`devDependencies` so CI type-checks and tests run). The core's runtime
dependency count stays **zero**. A consumer that uses the Anthropic adapter
installs the SDK; one that doesn't, doesn't. This is a deliberate, ADR-recorded
softening of the "zero dependencies" stance from ADR-0001 — scoped to one
optional adapter.

### 2. A transport seam isolates the SDK

The adapter defines its own tiny `AnthropicTransport` interface
(`createMessage(params) -> RawAnthropicMessage`). The real transport
(`createRealAnthropicTransport`) **lazily** `import()`s the SDK the first time a
request is made and throws a clear `ProviderConfigError` if it is not installed.
Tests inject a stub transport and never load the SDK or touch the network.
The adapter's own code is typed against local interfaces, not SDK types, so
`tsc` does not depend on the SDK being present.

### 3. Provider-neutral error hierarchy in contracts

`contracts/index.ts` gains `ProviderError` (with `provider`, `status`,
`retryable`) and subclasses `ProviderAuthError`, `ProviderRateLimitError`,
`ProviderTimeoutError`, `ProviderUnavailableError`, `ProviderRequestError`,
`ProviderResponseError`, plus `ProviderConfigError` (a `ValidationError`).
These are generic — "provider" is any external vendor. The Anthropic adapter's
`mapAnthropicError` translates SDK/API failures onto them by inspecting
`status` / error-name strings (not `instanceof` on SDK classes, so stubs work).

### 4. Configuration from the environment, validated, never logged

`loadAnthropicConfig(input?, env?)` resolves `apiKey` (required), `model`,
`timeoutMs`, `maxTokens`, `maxRetries` from an explicit object → env vars →
defaults, throwing `ProviderConfigError` with secret-free messages on missing
or invalid values. `AnthropicModelProvider.describe()` returns the resolved
config **without the API key**. A `redactSecrets` helper strips known secrets
from any derived error message as defence in depth (the adapter never
interpolates the key itself).

### 5. Provider registry in core

`ModelProviderRegistry` (core) resolves `ModelProvider` instances by id
("anthropic", "openai", ...) from factories the wiring layer registers. It
imports nothing provider-specific. `anthropicFactory(...)` (adapter) produces a
factory the app registers, so core never imports the adapter.

### 6. Audit via a decorator, content logging off by default

`AuditedModelProvider` (core) wraps any `ModelProvider` and records
`model_provider_requested`, `model_execution_started`,
`model_execution_completed`, `model_execution_failed` — with provider, model,
token usage, and sizes, plus correlation ids read from `request.metadata`. It
**never** records API keys or headers. Prompt/response **content is not logged
unless `logContent: true` is explicitly set**; then only a truncated preview.

## Options considered

| Concern        | Chosen                                    | Alternatives rejected                                                                                                    |
| -------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| SDK dependency | optional peer dep + lazy import           | hard `dependency` (forces install on all); vendoring HTTP calls (reimplements the SDK)                                   |
| SDK isolation  | local transport interface + stub in tests | `jest`-style module mocking (no test framework, brittle); calling the real API in tests (non-deterministic, needs a key) |
| Error model    | typed hierarchy in contracts              | returning result objects (loses `throw` ergonomics); leaking SDK error classes (couples core)                            |
| Audit          | decorator around `ModelProvider`          | orchestrator-side hooks (model calls happen inside executors, not the orchestrator)                                      |

## Consequences

- Core still imports no provider SDK; a test asserts `core/` and `contracts/`
  contain no Anthropic dependency.
- Adding OpenAI/Google later = a new adapter file + `registry.register(...)`,
  no core change.
- The `-latest` default model alias should be pinned per deployment.
- Real end-to-end calls remain a manual/staging step; there is no live
  integration test (by design — tests are deterministic and offline).
- `describe()` on `AnthropicModelProvider` is an adapter extra, not part of the
  `ModelProvider` contract.
