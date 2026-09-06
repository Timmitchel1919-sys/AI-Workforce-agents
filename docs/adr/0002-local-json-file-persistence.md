# ADR-0002: Persistence behind repository interfaces, JSON files first

**Status:** Accepted
**Date:** 2026-09-06
**Supersedes:** none
**Related:** [ADR-0001](0001-modular-provider-agnostic-workforce.md)

## Context

Phase 1 kept all Workforce state (tasks, agents, approvals, handoffs, audit
events) in memory. Phase 2A introduces approval-gated execution: a task can be
parked in `awaiting_approval` and resumed later — possibly after the process
has restarted. That requires durable state, without coupling the core domain to
a specific database.

## Decision

### 1. The core depends only on a `Repository<T>` interface

`contracts/persistence.ts` defines:

- `Repository<T extends Entity>` — `upsert`, `findById`, `list`, `delete`,
  `clear`. Synchronous.
- `PersistenceProvider` — one `Repository` per durable collection.

Every core system (`AgentRegistry`, `TaskSystem`, `HandoffSystem`,
`ApprovalSystem`, `AuditLog`) takes a `Repository` by constructor injection and
defaults to `InMemoryRepository` when none is supplied. The core imports no
concrete store.

### 2. First implementation: one JSON file per collection

`adapters/persistence/json-file-persistence.ts` provides `JsonFileRepository`
(one file) and `JsonFilePersistence` (a directory of files: `tasks.json`,
`agents.json`, `approvals.json`, `handoffs.json`, `audit-events.json`).

- Loads its file into an in-memory `Map` on construction, so a fresh instance
  pointed at the same path transparently resumes prior state.
- Every mutation rewrites the whole file **atomically**: write `*.tmp`, then
  `renameSync`.
- A corrupt or unrecognized file throws on load rather than silently dropping
  data.

### 3. Synchronous interface, deliberately

Keeping `Repository` synchronous means the task/approval lifecycle code stays
straight-line and deterministic, and the 35 Phase 1 tests needed no changes.
The trade-off: a future networked store (Postgres, DynamoDB) cannot implement
this exact interface — it would need an async revision. That is an explicit,
ADR-gated change for a later phase, not something to pre-build now.

## Options considered

| Option                                | Verdict                                                                                                                                        |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **JSON file per collection (chosen)** | Zero dependencies, human-readable, trivially replaceable, good enough for a single-process local workforce.                                    |
| SQLite via `node:sqlite`              | Real embedded DB, but still experimental in Node 20/22 (emits warnings), and heavier than the current need. Revisit if query/scale needs grow. |
| SQLite via `better-sqlite3`           | Solid, but adds a native compiled dependency — against the "no unnecessary dependencies" rule this early.                                      |
| Keep in-memory only                   | Fails the resume-after-restart requirement.                                                                                                    |

## Consequences

- State survives process reinitialization when a `JsonFilePersistence` is wired
  in (proven by tests in `tests/persistence.test.ts` and
  `tests/approval-execution.test.ts`).
- Concurrency is single-writer/single-process. No file locking. Concurrent
  processes writing the same directory is unsupported for now.
- Whole-file rewrite is O(n) per mutation — fine for hundreds/thousands of
  records, not for high volume. The audit collection is the most likely first
  candidate to outgrow it.
- Secrets are never written to persistence (nothing in the persisted entities
  carries credentials; providers read keys from the environment at call time).
- Swapping stores is a wiring change at the application entry point plus a new
  adapter — no core changes.

## Action items

1. Add file locking or a single-writer guard before supporting multiple
   processes.
2. Write a follow-up ADR if/when an async `Repository` revision is needed.
3. Consider a dedicated append-only sink for audit events if volume grows.
