# ADR-0003: Adopt ESLint + Prettier (syntactic only)

**Status:** Accepted
**Date:** 2026-09-06
**Related:** [ADR-0001](0001-modular-provider-agnostic-workforce.md)

## Context

Phase 1 deferred linting, relying on `tsc --noEmit` under `strict`. The
codebase has since roughly doubled (persistence, approval-gated execution,
permission enforcement, ~60 tests) and CI is being added. A consistent
automated style and a lint pass now pay for themselves; before, they would have
been tooling for appearance.

## Decision

Add, as dev dependencies only:

- **ESLint 9** flat config (`eslint.config.js`) with `@eslint/js` recommended
  and `typescript-eslint` recommended (**syntactic rules only** — no
  type-aware/`project`-based rules), plus `eslint-config-prettier` to disable
  stylistic rules that Prettier owns.
- **Prettier 3** with an explicit config (`printWidth: 80`, double quotes,
  `trailingComma: all`, semicolons) matching the style already written by hand.

npm scripts: `lint`, `format`, `format:check`. `check` now runs
`typecheck → lint → format:check → test`. CI runs the same.

## Rationale for "syntactic only"

Type-aware linting (`recommendedTypeChecked`, `no-floating-promises`, etc.)
requires ESLint to type-check the project a second time — slower, and
duplicating what `tsc` already guarantees. `tsc --noEmit` stays the
type-correctness gate. Syntactic ESLint still catches the useful class of
mistakes (unused vars, unsafe `any` patterns, obvious bugs) cheaply.

## Options considered

| Option                                     | Verdict                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------ |
| **ESLint (syntactic) + Prettier (chosen)** | Real value now, small dependency footprint, fast CI.                     |
| Biome (one tool, no deps chain)            | Attractive, but less mature ecosystem/editor integration; revisit later. |
| Type-aware ESLint                          | Deferred — cost outweighs benefit while `tsc` strict already runs.       |
| Nothing (keep `tsc` only)                  | No longer sufficient as the codebase and contributor surface grow.       |

## Consequences

- All existing code was formatted once (`prettier --write .`) and passes
  `eslint .` with zero warnings.
- Contributors need `npm install` (dev deps) and, ideally, editor integration.
- Runtime dependency count is still **zero**; these are dev-only.
- If the tooling ever becomes noise, `check` and CI can drop the lint/format
  steps without touching product code.
