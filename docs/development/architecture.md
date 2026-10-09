# Architecture

This is the working summary. The canonical, exhaustive description is
[`docs/architecture.md`](../architecture.md); this page orients new work and
records the pieces that most often cause mistakes.

## Shape

AI Workforce is a **modular monolith** with two delivery surfaces in one repo:

```
contracts/   Shared types, pure validators, and the agent execution boundary. No runtime deps.
core/        The Workforce domain: registries, tasks, handoffs, permissions,
             approvals, context, audit, model registry, tool pipeline,
             workflow engine, orchestrator, logging, events.
adapters/    Vendor/project seams: model providers, tool doubles, JSON file +
             Firestore persistence, Money Mind project adapter, Firebase ports.
agents/      Concrete General Agents (research, project-manager, developer, qa).
control/     Control & Operations layer (query + command services, view models).
api/         Composition root: dependency-free Node HTTP handler + Firebase wiring.
ui/          React + TypeScript + Vite Control Center (a separate app).
functions/   Firebase Functions entry points (codebase "control-plane").
tests/       Deterministic, offline tests (node:test).
docs/        Architecture, ADRs, and these development guides.
```

## Dependency direction (one-way, enforced by review and tests)

```
ui        ──HTTP──▶ api ──▶ control ──▶ core ──▶ contracts
                              │            ▲
                              └──▶ adapters┘   (composition/wiring only)
agents ──▶ core ──▶ contracts
adapters ──▶ contracts
```

- `core/` never imports `adapters/`, `agents/`, `control/`, `api/`, or a vendor SDK.
- `ui/` talks **only** to the `api/` HTTP surface. It never imports Firestore,
  the Admin SDK, `core/`, or `control/`, and never reaches a database, shell,
  filesystem, or credential. See `AGENTS.md` — "Frontend must not access
  Firestore directly."
- Only `api/` (and `adapters/firebase/`) wire a vendor SDK into the stack.

## Core building blocks

- **Registries** — `AgentRegistry`, `ProjectRegistry`, `ModelProviderRegistry`,
  `ToolRegistry`. Declarative, validated, frozen on registration.
- **Lifecycles** — `TaskSystem`, `WorkflowSystem`, `HandoffSystem`,
  `ApprovalSystem`. Single writer per entity; illegal transitions throw.
- **Orchestrator** — validate → permission gate → approval gate → dispatch →
  audit. No autonomy; `resume` applies an externally supplied human decision.
- **Tool pipeline** — `ToolExecutionEngine` is the one path an agent runs a tool
  through: validate → eligibility → limits → permission → approval → execute →
  validate → audit.
- **Persistence** — `Repository<T>` (sync) is the only persistence type the core
  knows. `InMemoryRepository` is the default; `JsonFileRepository` and
  `FirestoreRepository` (bridged by `CachedRepository`) are adapters.
- **Observability** — `core/logging` (structured logger, levels, redaction) and
  `core/events` (typed internal event foundation). Audit is a separate,
  persisted, append-only trail in `core/audit`.

## Service / repository pattern

Raw persistence calls never live in UI components or controllers:

```
UI page ─▶ feature client (ui/src/features/**/api) ─▶ api/ HTTP surface
        ─▶ control service ─▶ core system ─▶ Repository<T> ─▶ store (memory / JSON / Firestore)
```

The UI half mirrors this with `api/client.ts` + per-feature clients and
TanStack Query hooks; the backend half is `control/services/*` +
`core/**` repositories injected by the composition root.

## The UI shell

`ui/src/main.tsx` → `app/provider/AppProviders.tsx` wraps the tree in:

```
ThemeProvider → I18nProvider → NotificationProvider → QueryProvider → AuthProvider → RouterProvider
```

- **Router** — `app/router.tsx`; protected routes are gated by
  `auth/RequireAuth.tsx`.
- **Auth** — Firebase Authentication (client) is the authentication authority;
  the Control Plane verifies the resulting ID token server-side. Frontend state
  is never the authorization decision.
- **Design system** — tokens in `styles/tokens.css`, theme in `themes/`,
  primitives in `components/ui`, state views in `components/states`, layouts in
  `components/layout`.

## Where to read more

- [Development docs](.) (this folder)
- [docs/architecture.md](../architecture.md) — full component map and lifecycles
- [docs/control-plane.md](../control-plane.md) — operators, commands, views
- [docs/firebase.md](../firebase.md) — Firebase setup and ports
- [docs/adr/](../adr/) — decision records
