# Dependency Vulnerability Exception Registry

This document records authorized, temporary exceptions for transitive vulnerabilities identified in project dependencies.

## Policy

1. **Critical Severity**: Blocks CI and deployments unless documented with compensating controls and an active expiry date.
2. **High Severity**: Blocks CI and deployments unless documented with compensating controls and an active expiry date.
3. **Moderate / Low Severity**: Monitored and triaged during routine dependency maintenance.
4. **No Permanent Ignores**: All exceptions must include an expiration date and remediation plan.

---

## Active Exceptions

Last reviewed 2026-10-31 against `npm audit` for root and `ui/`. Root has no exceptions left; only moderate UI devDependency advisories remain.

### 1. uuid (UI)

- **Package**: `uuid`
- **Advisory**: [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq)
- **Severity**: Moderate
- **Affected Versions**: `<11.1.1`
- **Introduced Via**: Transitive in `@storybook/addon-actions`
- **Reason**: Buffer bounds check issue in v3/v5/v6 when external buffer is passed.
- **Compensating Controls**:
  - Application uses `node:crypto` (`randomUUID()`), not vulnerable `uuid` APIs directly.
- **Owner**: Security Operations
- **Expiry Date**: 2026-12-31
- **Remediation Plan**: Transitive update via upstream Google Cloud libraries.

---

### 2. @jest/transform & jest-haste-map (UI DevDependencies)

- **Package**: `@jest/transform` / `jest-haste-map`
- **Advisories**: Transitive via Storybook dependency graph (`micromatch` / `braces`)
- **Severity**: Moderate
- **Introduced Via**: UI devDependency `@storybook/addon-docs`
- **Reason**: Dev tooling for Storybook component documentation. Not shipped in production bundle.
- **Compensating Controls**: Offline development environment only.
- **Owner**: Frontend Team
- **Expiry Date**: 2026-12-31
- **Remediation Plan**: Upgrade Storybook in scheduled maintenance.
