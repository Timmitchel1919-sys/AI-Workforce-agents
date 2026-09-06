# AI Workforce Architecture

The Workforce is a TypeScript modular monolith. Core domain modules have no dependency on model providers, GitHub, project repositories, or external infrastructure. Provider and project capabilities enter through contracts in `contracts/` and implementations under `adapters/`.

## Core components

- `AgentRegistry` stores validated agent metadata and finds eligible agents.
- `TaskSystem` owns deterministic lifecycle transitions.
- `HandoffSystem` validates agent-to-agent handoffs.
- `Orchestrator` routes a queued task to the alphabetically first eligible agent and records outcomes.
- `PermissionSystem` is deny-by-default.
- `ApprovalSystem` represents human decisions; it does not grant tool access by itself.
- `ContextSystem` permits access only when task and project scopes match.
- `AuditLog` keeps local structured events.

## Lifecycles

Tasks begin as `created`, then may be `queued`, `running`, `blocked`, `awaiting_approval`, `completed`, `failed`, or `cancelled`. A handoff transfers explicit completed work, remaining work, acceptance criteria, artifacts, and risks. Agents are registered before routing and are selected only when both task type and project are allowed.

## Adapters and isolation

`ModelProvider`, `ToolProvider`, and `ProjectAdapter` are provider-neutral contracts. A future Money Mind adapter may implement `ProjectAdapter`; it must not pull Money Mind internals into this repository. Context, permission requests, and audit records carry project/task scope so context is not implicitly shared.

## Extending and testing

Implement an adapter behind its contract, register only least-privilege agent permissions, and add deterministic tests before connecting a real provider or project. Run `npm test` for compile-and-test validation and `npm run typecheck` for type checking.
