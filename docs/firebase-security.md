# Firebase Security Hardening (Layer 6)

## Trust boundary

```
Browser (ui/)
  └─ Firebase Auth (identity)
  └─ Firebase App Check (device/app attestation — not identity)
         │
         ▼
Firebase Hosting
  └─ /api/** rewrite → Cloud Function (controlPlaneApi, us-central1)
         │
         ▼
Control Plane API handler
  └─ Admin SDK (Firestore, Storage, App Check verifier)
         │
         ▼
Firestore / Storage
```

The browser **never** touches Firestore or Storage directly. All UI
reads and writes go through the Control Plane HTTP API, which
authenticates, authorizes, enforces project scope and policy, and
audits.

## Firestore client access

```
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

`allow read, write: if false` is the deliberate, authoritative client
posture. Admin-SDK access bypasses rules by design — that is the ONLY
authorized path. Any attempt to move a collection to direct client
access MUST be preceded by a security review and a specific `allow`
rule for that collection; no implicit relaxation is permitted.

## Storage client access

```
service firebase.storage {
  match /b/{bucket}/o {
    match /{allPaths=**} {
      allow read, write: if false;
    }
  }
}
```

Signed URLs are generated server-side only when a specific flow
requires them. No public Storage paths are added during Layer 6.

## Admin SDK boundary

- `firebase-admin` is a server-only dependency. The `ui/` workspace
  must never import it — a test (`tests/api-security.test.ts`)
  asserts `firebase-admin` does not appear in `ui/package.json`.
- Admin SDK initialization lives in `adapters/firebase/*`, imported
  only from `api/*` and `control/*` composition sites.
- Service account credentials are never committed. Local development
  uses Application Default Credentials or `GOOGLE_APPLICATION_CREDENTIALS`
  pointing outside the repo. The `.env` files are gitignored.

## Sensitive collections

| Collection                  | Policy                                                               |
| --------------------------- | -------------------------------------------------------------------- |
| `operators`                 | server-only, mutable (via Control Plane access service)              |
| `access_control`            | server-only, mutable (bootstrap lock, admin counter)                 |
| `operator_profiles`         | server-only, mutable                                                 |
| `canonical_security_events` | server-only, **append-only** (transaction.create)                    |
| audit records               | server-only, **append-only**                                         |
| `approvals`                 | server-only, mutable (via Approval system)                           |
| destructive actions         | server-only, mutable with append-only history                        |
| security policies           | server-only, mutable (admin + `manage_security_policy`)              |
| agents / tasks / workflows  | server-only, mutable                                                 |
| projects                    | server-only, mutable                                                 |
| integrations                | server-only, mutable                                                 |
| secret references           | server-only, mutable (metadata only, raw values via Vault — Layer 7) |
| deployment records          | server-only, mutable with history                                    |

## Firebase App Check

- Client (`ui/`): initialize App Check in the Firebase SDK where
  configured. Preferred web provider: reCAPTCHA Enterprise. The
  public site key may be delivered via `VITE_*` — a public web
  config value, never a secret.
- Server: `AppAttestationVerifier` port in `api/security/app-check.ts`.
  Production adapter uses `getAppCheck().verifyToken(token)` from
  Firebase Admin. The default verifier reports
  `verifier_unavailable`, which fails CLOSED under `enforced` mode.
- Modes (server env `APP_CHECK_MODE`):
  - `disabled` (dev default) — never blocks.
  - `monitor` — observes; emits events but never blocks.
  - `enforced` — blocks missing / invalid / verifier-unavailable on
    protected routes.
- Debug tokens must never be committed and cannot activate silently
  in production: `resolveAppCheckMode(env)` only honors
  `disabled | monitor | enforced` and defaults to `disabled` on any
  unknown value.

## Environment separation

- `.env.example` documents every expected env name. `.env` and
  `.env.*` are gitignored.
- `VITE_*` carries only intentionally public Firebase web config
  values (API key, auth domain, project id, storage bucket, messaging
  sender id, app id) and the public App Check site key. No service
  account material or server secrets ever reach `VITE_*`.
- Firebase project id is validated at runtime (where supported); a
  production runtime unexpectedly pointing to a dev/test project
  produces a high-severity configuration error.

## Emulator development

```
firebase emulators:start
```

Auth (9099), Firestore (8080), Storage (9199), UI (4000) — see
`firebase.json`. App Check in `disabled` mode works out of the box;
when a debug token is desired, set it explicitly in local-only
tooling (never committed, never in `VITE_*` production bundles).

## Firebase Hosting rewrite

Hosting rewrites `/api/**` to the `controlPlaneApi` Cloud Function
in `us-central1`. The function is the only authorized direct
consumer of Firestore/Storage via the Admin SDK. Direct function
ingress outside the Hosting rewrite is tracked for Layer 13
(edge/WAF/origin bypass).

## Automated verification

- `tests/api-security.test.ts` reads `firestore.rules` and
  `storage.rules` and asserts the deny-all posture is unchanged.
- Same test asserts `firebase-admin` is not a dependency of `ui/`.
- CI runs the full test suite on Node 20.x and Node 22.x in GitHub
  Actions on every push to `main`.
