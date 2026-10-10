# Access control (AUTHZ-1)

## Authentication ≠ authorization

|                    | Proves               | Source                                                              |
| ------------------ | -------------------- | ------------------------------------------------------------------- |
| **Authentication** | WHO the user is      | Firebase Authentication → verified ID token → Firebase **UID**      |
| **Authorization**  | WHAT the user may do | AI Workforce **operator account** `operators/{uid}` → status + role |

A Firebase account — even with a verified email — grants **nothing**. Only an
operator account with status `active` and a role produces an
`OperatorPrincipal`. Custom token claims are **not** used for authorization.

```
Firebase ID token ─verifyIdToken─▶ UID ─operators/{uid}─▶ ACTIVE + role ─▶ capabilities
                                         └─ missing / pending / rejected / suspended / revoked ─▶ no access (401)
```

The account is read from Firestore on **every** Control Plane request, so a
suspension or revocation takes effect on the next request (no stale claims).

## Roles

The existing roles (`contracts/control.ts`), least → most privileged:

| Role       | Capabilities                                                      |
| ---------- | ----------------------------------------------------------------- |
| `viewer`   | `view`                                                            |
| `operator` | viewer + approvals, task/workflow control, execution planning     |
| `admin`    | operator + `disable_agent` / `enable_agent` + **`manage_access`** |

`admin` is the highest role; no new roles were introduced. A role can only be
granted by someone whose role ranks at least as high (`ROLE_RANK`), and only
`admin` holds `manage_access`.

## Operator lifecycle

```
pending ──approve──▶ active ──suspend──▶ suspended ──reactivate──▶ active
   │                   │                     │
   └─reject─▶ rejected └──────revoke─────────┴──▶ revoked (terminal)
rejected ──approve──▶ active
```

- **Pending access** — the first `GET /api/me/access` of a signed-in identity
  records a `pending` account (UID, email, display name, email-verified flag —
  nothing else). It is not granted anything.
- **Approval** — an administrator selects a role and a project scope
  (`"*"` or registered project ids). Permissions derive from the role; nothing
  is copied from the approving administrator.
- **Rejection / suspension / revocation** — update the authoritative status;
  the Firebase identity is never deleted; audit history is never deleted.
- **Role change** — active accounts only; validated and audited.
- Administrators cannot change their **own** account, and the **last active
  administrator** cannot be suspended, revoked or demoted (enforced atomically
  in Firestore via `access_control/summary.activeAdmins`).

## Control Plane API

| Route                                                                              | Auth                                                                                                 |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `GET /api/me/access`                                                               | verified token only → `{ authenticated, authorized, status, role?, allowedProjects?, capabilities }` |
| `GET /api/operators`                                                               | `manage_access`                                                                                      |
| `POST /api/commands/approve-access` `{ operatorId, role, allowedProjects }`        | `manage_access`                                                                                      |
| `POST /api/commands/reject-access` `{ operatorId, reason? }`                       | `manage_access`                                                                                      |
| `POST /api/commands/suspend-access` `{ operatorId, reason? }`                      | `manage_access`                                                                                      |
| `POST /api/commands/reactivate-access` `{ operatorId }`                            | `manage_access`                                                                                      |
| `POST /api/commands/revoke-access` `{ operatorId, reason? }`                       | `manage_access`                                                                                      |
| `POST /api/commands/change-operator-role` `{ operatorId, role, allowedProjects? }` | `manage_access`                                                                                      |

Invalid/expired token → 401. Authenticated without an active account → 401 on
every protected route. Missing capability → 403. Concurrent change or
last-administrator rule → 409. All writes happen server-side in Firestore
transactions (revision check); the browser never touches Firestore (rules stay
deny-all).

## UI

- **Awaiting Access** shows the backend state: pending, declined, suspended,
  revoked, or "could not be checked" (the Control Plane was unreachable —
  nothing is assumed). **Check access again** refreshes the ID token and asks
  `GET /api/me/access`; it navigates only when the backend says `authorized`.
  While pending, the page re-checks every 60 s (visible tab only, at most 20
  times).
- **Settings → Users & Access** (`/settings/access`) is shown to
  administrators only (UX). The backend enforces `manage_access` regardless.
- "Encrypted connection (HTTPS)" appears only when the page is served over
  HTTPS — it refers to TLS, not to any application-layer encryption.

## Audit events

`access_event` with `data.action`:
`initial_admin_bootstrapped`, `bootstrap_already_provisioned`,
`bootstrap_refused`, `access_requested`, `access_approved`, `access_rejected`,
`operator_suspended`, `operator_reactivated`, `operator_role_changed`,
`access_revoked` — with `actor`, `operatorId`, status/role transition and
correlation id. Every administrative command additionally records the standard
`control_command` event (including denied attempts). No token, password or
credential is ever recorded.

## Initial administrator bootstrap

The very first administrator cannot be approved by anyone, so it is
provisioned once by a **trusted, server-side tool** — not an HTTP route, not a
Cloud Function, not part of the browser bundle:

1. **Find the UID** of the existing Firebase account that belongs to the
   platform owner: Firebase Console → _Authentication_ → _Users_ → copy the
   _User UID_. (No new account is needed; the email is never hardcoded.)
2. **Provide Admin credentials** on the trusted machine, outside the
   repository: `gcloud auth application-default login` (an account with access
   to the project), or `GOOGLE_APPLICATION_CREDENTIALS` pointing to a
   service-account key stored outside the repo.
3. **Run** (PowerShell shown; the UID is supplied at run time and never
   committed or used in a `VITE_*` variable):

   ```powershell
   $env:FIREBASE_PROJECT_ID = "ai-workforce-agents"
   $env:INITIAL_ADMIN_UID = "<uid from step 1>"
   npm run admin:bootstrap
   Remove-Item Env:INITIAL_ADMIN_UID
   ```

4. The owner clicks **Check access again** on the Awaiting Access page and
   enters the Control Center.

Outcomes: `created` (first run), `already_provisioned` (same UID again — no
duplicate), `refused` (an administrator already exists or the lock is held by
another UID — exit code 2). The tool verifies the Firebase user exists and is
not disabled, prints only a masked UID, and writes the audit event.

After the bootstrap, **every** further access decision goes through
Settings → Users & Access. The lock (`access_control/bootstrap`) makes the
bootstrap a one-time operation; there is no universal override.

## Operational recovery

If every administrator were ever lost (e.g. all accounts deleted in Firebase),
recovery is a separate, deliberate operation by someone with Google Cloud
project access: review the `operators` and `access_control` documents in the
Firebase Console, restore an administrator account and the
`access_control/summary.activeAdmins` count, and record the intervention. The
application deliberately offers no hidden backdoor for this.

## Operator profile photo

An ACTIVE operator can upload or remove their own profile photo on
**Profile** (top-bar account menu → Profile):

- `GET /api/me/profile` — own profile: display name and email from the
  operator account, role from the principal, optional `avatarDataUrl`.
- `PUT /api/me/profile/photo` `{ dataUrl }` / `DELETE /api/me/profile/photo`.

The operator id always comes from the verified token, never from the request.
The Control Plane accepts only a PNG, JPEG or WebP data URL whose bytes match
the declared type, at most 256 KB decoded (the UI centre-crops and resizes to
256 × 256 first). Photos live in `operator_profiles/{uid}`, separate from the
authoritative `operators/{uid}` account, and are written only by the Control
Plane. Changes are audited as `access_event` (`profile_photo_updated`,
`profile_photo_removed`) without the image data. The display name is edited on
the Firebase Auth profile; the refreshed ID token carries it to the account.
