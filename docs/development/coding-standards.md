# Coding Standards

- TypeScript strict mode; no unbounded `any` in production paths.
- Backend uses ESM/NodeNext and explicit `.js` import specifiers. UI uses Vite bundler resolution.
- Validate all untrusted HTTP bodies, query parameters, IDs, and provider output at boundaries.
- Authorization belongs in Control Plane/domain services; UI guards are discovery/UX only.
- Use `apiRequest` for browser API calls. Never access Firestore directly from UI.
- Never log credentials, tokens, raw secrets, or unredacted provider errors.
- Model configured, unavailable, empty, and error states separately; never fabricate success or sample production data.
- Add focused tests for every behavior change and negative security case.
- Reuse design tokens, shared states, i18n keys, semantic HTML, focus-visible states, and reduced-motion behavior.
- Preserve unrelated working-tree changes. Do not commit generated build output or `.env` files.

Before review run root typecheck/lint/format/tests/build and UI test/build commands described in `testing-strategy.md`.
