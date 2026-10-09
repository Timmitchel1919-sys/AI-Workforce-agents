# Testing Strategy

All tests are **deterministic and offline**. No test may make a real AI API
call, touch a real external service, hit a real Money Mind checkout, or require
Firebase / an emulator. This is a hard rule, not a preference.

## Two runners

| Surface                                                                     | Runner                             | Command                                                           |
| --------------------------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------- |
| Backend (`contracts/`, `core/`, `adapters/`, `agents/`, `control/`, `api/`) | `node:test` + `node:assert/strict` | `npm test` (compiles with `tsc`, then runs compiled `dist/tests`) |
| UI (`ui/`)                                                                  | Vitest + Testing Library (jsdom)   | `cd ui && npm test` (or `npx vitest run`)                         |

Backend tests import from the barrel (`"../core/index.js"`) so they exercise the
public surface. UI tests use `@testing-library/react` and the shared setup in
`ui/src/test/setup.ts`.

## What to test

Every implementation adds or updates tests. Cover, at minimum:

1. **Happy path** — the intended behaviour, end to end through the owning system.
2. **Validation** — malformed input rejected with the right error class/message.
3. **Boundaries** — limits, pagination, size caps, empty states.
4. **Failure modes** — the system fails closed and audits the failure.
5. **Security** — deny-by-default, project isolation, redaction (no secret ever
   appears in output or logs).

For the foundation layer specifically: logging level thresholds, redaction of
sensitive keys, event publish/subscribe/unsubscribe, handler isolation, and the
notification queue (render, dismiss, provider-boundary error).

## Conventions

- One `test(...)` per behaviour, with a description that reads as a sentence.
- Use `assert.deepEqual` / `assert.throws` / `assert.rejects` over ad-hoc checks.
- Build small explicit fixtures at the top of the file.
- Never assert on ordering the system does not guarantee.
- Never weaken or delete an existing assertion to make a change pass.

## Determinism

- Inject clocks/ids where the core already allows it; avoid `Date.now()` in
  assertions.
- Prefer in-memory seam fakes (e.g. Firebase adapters, model providers) over
  mocks of internal modules.
- A flaky test is a bug; fix the cause, do not raise the timeout reflexively
  unless the cost is genuinely environmental (as documented in
  `vitest.config.ts`).

## Gate before completion

Do not report work as done until all of these pass:

```bash
# root
npm run typecheck
npm run lint
npm test
npm run build
# ui
( cd ui && npm run lint && npm test && npm run build )
```

Report the actual result. If a check does not pass, say so and why.
