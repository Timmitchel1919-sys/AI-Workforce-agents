# API Security Middleware (Layer 5)

Narrow, defense-in-depth primitives the Control Plane HTTP handler
composes before any identity / capability / project / policy check.
These are **never** a replacement for the capability authorization
and security-policy enforcement in Layers 1–3.

## Request pipeline

```
HTTP request
  → security headers      (api/security/headers.ts)
  → CORS preflight        (api/security/cors.ts)
  → correlation id        (control/correlation.ts)
  → rate limiter          (api/security/rate-limit.ts)
  → App Check             (api/security/app-check.ts)
  → authentication        (existing OperatorDirectory + IdentityVerifier)
  → active operator       (existing capabilitiesFor / principalFor)
  → capability check      (existing operatorCan)
  → project scope         (existing operatorCanAccessProject)
  → schema validation     (existing per-route validators)
  → Governance Policy     (existing GovernancePolicyEngine)
  → Security Policy       (Layer 2 SecurityPolicyEngine)
  → MFA / reauth evidence (Layer 3 destructive gate)
  → DestructiveActionService.assertApproved(...)
  → executor
  → AuditEvent + CanonicalSecurityEvent
  → safe JSON response
```

Nothing after `applyCors` runs for a short-circuited preflight; nothing
after `appCheckBlocks` runs when enforced App Check refuses.

## Route security metadata

Routes may attach a typed policy object. Fields:

```ts
interface RouteSecurityPolicy {
  authentication: "public" | "firebase_authenticated" | "active_operator";
  capability?: ControlCapability;
  projectScope?: boolean;
  appCheck?: "optional" | "required";
  risk?: "low" | "medium" | "high" | "critical";
  securityPolicyAction?: string;
  destructive?: boolean;
  requireJson?: boolean;
  maxBodyBytes?: number;
  rateLimitProfile?: string;
}
```

Layer-5 ships the primitives (`apiError`, `apiSecurity` option on
`createControlPlaneApi`, rate-limiter profiles, App Check hook). The typed
high-risk command table is active: it selects the pre-auth rate profile and
App Check requirement, then performs an early capability gate after
authentication. Core command services still repeat their authoritative
capability and project checks. Routes not yet present in the typed table retain
those existing core checks and the production-wide App Check path policy.

Security-policy and secret-reference mutation routes are also in this table.
They require App Check, administrator capabilities, trusted Firebase
MFA/reauth evidence, and a destructive request bound to the exact action and
target. Secret-reference bodies accept metadata only; credential-shaped fields
are rejected rather than ignored.

## Rate limiting

Profiles (defaults in `DEFAULT_RATE_LIMIT_PROFILES`):

| Profile                 | Window | Max |
| ----------------------- | ------ | --- |
| `public_default`        | 60s    | 60  |
| `authenticated_default` | 60s    | 600 |
| `auth_sensitive`        | 60s    | 20  |
| `security_read`         | 60s    | 120 |
| `security_mutation`     | 60s    | 30  |
| `destructive_request`   | 60s    | 20  |
| `destructive_approval`  | 60s    | 60  |
| `deployment`            | 60s    | 10  |
| `access_management`     | 60s    | 30  |

Composite key = `profile:operatorId-or-ip`. Operator A's bucket
never consumes B's bucket. Limits are defense-in-depth: they never
substitute for capability authorization. On exhaustion the API
responds with `429` + `retry-after`.

## App Check

Server-authoritative modes (via `APP_CHECK_MODE` env):

- `disabled` — never blocks.
- `monitor` — observes, never blocks (missing/invalid outcomes still
  surface so canonical events can record them).
- `enforced` — blocks `missing`, `invalid`, and `unavailable` on
  routes that require App Check.

The verifier is a narrow port (`AppAttestationVerifier`); production
wires Firebase Admin's App Check verifier. The default verifier
reports `verifier_unavailable` so `enforced` mode fails CLOSED on
privileged routes when the real verifier is not wired.

The mode is **never** selected by client input. The header
(`x-firebase-appcheck`) is extracted centrally; no route handler
touches it. Tokens are never logged.

## CORS

- Exact origin allow-list only. Wildcard `*` is permitted ONLY when
  `allowCredentials` is false — the policy refuses to combine `*`
  with credentials.
- Preflight (`OPTIONS`) short-circuits before any auth logic.
- `vary: Origin` and `access-control-expose-headers` on every
  allowed response.
- `access-control-max-age` tunable per deployment.

## Security headers

Baseline (every response): `x-content-type-options: nosniff`,
`referrer-policy: no-referrer`,
`permissions-policy: accelerometer=(), …`,
`cross-origin-opener-policy: same-origin`,
`cross-origin-resource-policy: same-origin`,
`x-frame-options: DENY`.

Production-only (`apiSecurity.production=true`):
`strict-transport-security: max-age=63072000; includeSubDomains; preload`.

A separate CSP for the Hosting-served UI lives in `firebase.json` /
hosting config — not applied to API responses.

## Safe error model

Every error response: `{ error: { code, message, correlationId } }`.
Codes: `invalid_request | unauthenticated | forbidden | not_found |
conflict | payload_too_large | unsupported_media_type | approval_required
| rate_limited | security_dependency_unavailable | method_not_allowed |
app_check_missing | app_check_invalid | internal_error`. The server
NEVER returns stack traces, Firebase internals, SQL internals, file
paths, tokens, or secrets.

## Untrusted body fields

The API strips the following fields from mutation bodies before
handing them to downstream services. Authoritative values come from
the server-side execution path, not from client-supplied JSON:
`role`, `capabilities`, `isAdmin`, `authenticated`, `firebaseUid`,
`operatorId`, `allowedProjects`, `mfaVerified`, `reauthVerified`,
`approvalSatisfied`.

## Destructive action integration

Layer-3's `DestructiveActionService` now has a production approver
resolver and an observer that writes canonical security events:

- **`OperatorAccountApproverResolver`** — pre-loads a fresh account
  snapshot via `OperatorAccountStore.get` and resolves principals
  with `principalFor(...)`. Only `status === "active"` yields a
  principal. The resolver is MANDATORY at execution; the service
  fails closed when absent.
- **`createDestructiveSecurityEventObserver(store)`** — adapter that
  translates `DestructiveSecurityEvent` lifecycle signals into
  canonical `CanonicalSecurityEvent` records (category
  `destructive_action`), persisted to the append-only Layer-4 store.
  No raw tokens or request bodies leak into the event payload.

## MFA / reauth evidence boundary

`FirebaseMfaVerifier` and `FirebaseReauthenticationVerifier` derive evidence
only from the Admin-SDK-verified identity. MFA requires a verified Firebase
second-factor claim plus a valid, fresh `auth_time`; reauthentication requires
a valid, fresh `auth_time`. Missing, stale, or future timestamps fail closed.
Raw request-body booleans never enter the evidence path.

## Fail-closed availability

For HIGH/CRITICAL routes, a missing required security dependency
refuses execution:

| Dependency                         | Behavior when unavailable                                       |
| ---------------------------------- | --------------------------------------------------------------- |
| App Check verifier (enforced mode) | 403 `app_check_invalid` / 503 `security_dependency_unavailable` |
| Destructive approver resolver      | Layer 3 refuses with 403                                        |
| Security Policy Engine             | API refuses at policy gate                                      |
| Operator store                     | API refuses at authentication gate                              |

Low-risk reads are not gated on these dependencies' availability.
