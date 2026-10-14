# Dependency Vulnerability Exception Registry

This document records authorized, temporary exceptions for transitive vulnerabilities identified in project dependencies.

## Policy

1. **Critical Severity**: Blocks CI and deployments unless documented with compensating controls and an active expiry date.
2. **High Severity**: Blocks CI and deployments unless documented with compensating controls and an active expiry date.
3. **Moderate / Low Severity**: Monitored and triaged during routine dependency maintenance.
4. **No Permanent Ignores**: All exceptions must include an expiration date and remediation plan.

---

## Active Exceptions

### 1. @grpc/grpc-js (Root & UI)

- **Package**: `@grpc/grpc-js`
- **Advisories**: [GHSA-m9gg-hp2v-232j](https://github.com/advisories/GHSA-m9gg-hp2v-232j), [GHSA-f596-whhp-79r4](https://github.com/advisories/GHSA-f596-whhp-79r4)
- **Severity**: High
- **Affected Versions**: `<=1.14.4`
- **Introduced Via**: Transitive dependency of `firebase-admin` (root) and `@firebase/firestore` (UI)
- **Reason**: Upstream Firebase SDK bundles this version; breaking change to force alternative version.
- **Compensating Controls**:
  - Direct Firestore client access is completely blocked (`allow read, write: if false;`).
  - Server gRPC traffic communicates strictly over Google Cloud internal APIs / VPC, not exposed to public untrusted clients.
  - App Check and Firebase ID tokens are verified before any internal backend call.
- **Owner**: Security Operations
- **Expiry Date**: 2026-12-31
- **Remediation Plan**: Update `firebase-admin` and `firebase` as soon as upstream patch releases are published.

---

### 2. brace-expansion (Root & UI)

- **Package**: `brace-expansion`
- **Advisories**: [GHSA-q2hr-2g5m-vwhr](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr), [GHSA-qhr7-859c-m2p7](https://github.com/advisories/GHSA-qhr7-859c-m2p7), [GHSA-6j4f-fj2g-mc7p](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p)
- **Severity**: High
- **Affected Versions**: `4.0.0 - 5.0.11`, `<=1.1.20`, `2.0.0 - 2.1.6`
- **Introduced Via**: DevDependencies: `@typescript-eslint/typescript-estree`, `glob`, `eslint`
- **Reason**: Dev tooling dependency used exclusively during offline build/lint steps. Never bundled in production runtime.
- **Compensating Controls**:
  - Build and lint scripts execute in isolated CI environments.
  - Untrusted user input is never parsed through brace-expansion.
- **Owner**: Engineering Core
- **Expiry Date**: 2026-12-31
- **Remediation Plan**: Update ESLint and TypeScript-ESLint when patch versions are stabilized.

---

### 3. braces / micromatch (UI DevDependencies)

- **Package**: `braces` / `micromatch`
- **Advisory**: [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
- **Severity**: High
- **Affected Versions**: All versions prior to upstream fix
- **Introduced Via**: UI devDependency `@storybook/addon-essentials`
- **Reason**: Storybook devDependency used for UI component documentation. Never included in the Vite production build (`dist/`).
- **Compensating Controls**:
  - Production build does not include Storybook packages.
  - Isolated development tooling only.
- **Owner**: Frontend Team
- **Expiry Date**: 2026-12-31
- **Remediation Plan**: Upgrade Storybook to v8.6+ in scheduled frontend maintenance.

---

### 4. handlebars (UI DevDependencies)

- **Package**: `handlebars`
- **Advisories**: [GHSA-xw65-4hp5-5hc7](https://github.com/advisories/GHSA-xw65-4hp5-5hc7), [GHSA-8r5x-fm3f-whwj](https://github.com/advisories/GHSA-8r5x-fm3f-whwj), [GHSA-p8wg-vrv2-v86f](https://github.com/advisories/GHSA-p8wg-vrv2-v86f)
- **Severity**: Critical
- **Affected Versions**: `3.0.0 - 4.7.9`
- **Introduced Via**: UI devDependency `@storybook/addon-docs`
- **Reason**: Used exclusively in local Storybook doc generation. Never bundled into Vite production client code.
- **Compensating Controls**:
  - Vite client bundle verified: zero handlebars modules in `ui/dist/`.
  - Storybook runs locally and in offline doc testing, not in production runtime.
- **Owner**: Frontend Team
- **Expiry Date**: 2026-12-31
- **Remediation Plan**: Upgrade Storybook docs tooling to modern compiler.

---

### 5. source-map-js (UI DevDependencies)

- **Package**: `source-map-js`
- **Advisory**: [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)
- **Severity**: High
- **Affected Versions**: `1.0.0 - 1.2.1`
- **Introduced Via**: Dev build tooling (PostCSS / Tailwind)
- **Reason**: Offline source-map processing during `npm run build`.
- **Compensating Controls**:
  - Offline build tool only.
- **Owner**: Frontend Team
- **Expiry Date**: 2026-12-31
- **Remediation Plan**: Update build tools when patch versions are available.

---

### 6. uuid (Root & UI)

- **Package**: `uuid`
- **Advisory**: [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq)
- **Severity**: Moderate
- **Affected Versions**: `<11.1.1`
- **Introduced Via**: Transitive in `gaxios` / `@google-cloud/storage` / `@storybook/addon-actions`
- **Reason**: Buffer bounds check issue in v3/v5/v6 when external buffer is passed.
- **Compensating Controls**:
  - Application uses `node:crypto` (`randomUUID()`), not vulnerable `uuid` APIs directly.
- **Owner**: Security Operations
- **Expiry Date**: 2026-12-31
- **Remediation Plan**: Transitive update via upstream Google Cloud libraries.

---

### 7. @firebase/firestore-compat (UI)

- **Package**: `@firebase/firestore-compat`
- **Advisories**: Transitive advisory via `@firebase/firestore` / `@grpc/grpc-js`
- **Severity**: High
- **Introduced Via**: Transitive in `firebase` client SDK
- **Reason**: SDK compatibility wrapper.
- **Compensating Controls**: Direct client access disabled (`firestore.rules` deny-all).
- **Owner**: Security Operations
- **Expiry Date**: 2026-12-31
- **Remediation Plan**: Upstream update from Firebase SDK.

---

### 8. @jest/transform & jest-haste-map (UI DevDependencies)

- **Package**: `@jest/transform` / `jest-haste-map`
- **Advisories**: Transitive via Storybook dependency graph (`micromatch` / `braces`)
- **Severity**: High
- **Introduced Via**: UI devDependency `@storybook/addon-docs`
- **Reason**: Dev tooling for Storybook component documentation. Not shipped in production bundle.
- **Compensating Controls**: Offline development environment only.
- **Owner**: Frontend Team
- **Expiry Date**: 2026-12-31
- **Remediation Plan**: Upgrade Storybook in scheduled maintenance.
