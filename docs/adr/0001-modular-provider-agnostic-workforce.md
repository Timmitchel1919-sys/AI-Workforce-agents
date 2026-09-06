# ADR-0001: Modular, provider-agnostic Workforce foundation

**Status:** Accepted
**Date:** 2026-09-06
**Deciders:** AI Workforce maintainers

## Context

The Workforce must serve independent projects and future model/tool providers while retaining testability, traceability, and explicit human control over high-risk actions.

## Decision

Use a TypeScript modular monolith with dependency-free domain modules, Node's built-in test runner, and explicit contracts for models, tools, and projects. Permissions default to denial and human approval is a first-class recorded lifecycle.

## Options Considered

### Option A: Modular monolith

| Dimension | Assessment |
|---|---|
| Complexity | Low initially |
| Cost | Low |
| Scalability | Good through module boundaries |
| Team familiarity | High for TypeScript/Node work |

**Pros:** Deterministic tests, simple deployment, clear contracts.
**Cons:** Future independent scaling may require extraction.

### Option B: Microservices and provider-specific implementations

| Dimension | Assessment |
|---|---|
| Complexity | High |
| Cost | Higher operational cost |
| Scalability | Premature for current needs |
| Team familiarity | Lower |

**Pros:** Independent deployment boundaries.
**Cons:** Distributed coordination and provider lock-in arrive before product value.

## Consequences

- Provider abstractions prevent OpenAI, Anthropic, Google, or other providers from defining core behavior.
- Project adapters preserve AIMS, Money Mind, Mastery, and Tripod isolation.
- Deny-by-default permissions and approval records make sensitive work reviewable.
- Durable storage, real authentication, asynchronous workers, and production logging remain future decisions.

## Action Items

1. Maintain contract compatibility with tests.
2. Add integrations only through the adapter boundaries.
