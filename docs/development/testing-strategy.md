# Testing Strategy

## Required local gates

Root: `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`, `npm run build`, and `npm run security:check`. UI: `npm --prefix ui run test:ci`, `npm --prefix ui run lint`, and `npm --prefix ui run build`. Browser gates: `npm --prefix ui run test:e2e` and `npm run test:e2e:authenticated`. `npm run verify:release` runs the release gate in order (typecheck, lint, format, backend unit, Firebase emulator, UI unit, builds, both browser suites, security, diff check) and stops at the first failure.

`npm test` builds then runs deterministic compiled Node tests. Firebase integration uses `npm run test:firebase` with the demo project and Auth/Firestore/Storage emulators; never point emulator tests at production. UI tests use Vitest/jsdom.

Security tests require negative cases: missing/invalid identity, inactive account, insufficient capability, cross-project access, invalid body, App Check failure, lockdown, redaction, approval, replay/idempotency where relevant. A route existing or a mocked test passing is not runtime proof.

## Browser QA

Playwright (Chromium) with `@axe-core/playwright` is committed under `ui/e2e/`. Install the browser once from `ui/` with `npx playwright install chromium`.

- `npm --prefix ui run test:e2e` serves two unauthenticated builds: `4173` with no Firebase configuration (must fail closed) and `4174` with `VITE_ALLOW_DEVELOPMENT_DEMO_AUTH=true`. It covers landing → login → password-reset navigation, keyboard-accessible validation, fail-closed protected routing, critical/serious axe checks, and horizontal-overflow checks at 320, 375, 390, 430, 768, 1024, 1440, and 1920 px.
- `npm run test:e2e:authenticated` builds the backend, starts the Firebase Auth/Firestore/Storage emulators plus a Control Plane on 127.0.0.1:8787, and proves Firebase sign-in, pending-account denial, administrator-route denial for viewers, and sign-out. It requires Java for the emulators; the script downloads a checksum-pinned Firebase CLI when none is installed.
- Authenticated identities and passwords are generated per run and passed through the environment; no fixture credentials are committed.

These suites still do not cover screen-reader output, live provider health, or production configuration. Those remain manual and post-deployment checks, and a passing browser run is not proof that a deployment is healthy.

Failures are fixed or reported; tests are never weakened or skipped merely to obtain green status.
