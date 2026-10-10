# ADR-0014: Operator accounts as the source of authorization (AUTHZ-1)

- Status: Accepted
- Date: 2026-09-24

## Context

Authorization was derived solely from Firebase custom claims (`role`,
`allowedProjects`). Nothing in the system could assign a claim, so every
account — including the owner's — stayed on "Awaiting access". The Firebase
project had 2 users and 0 custom claims (verified read-only). Claims also
cannot be revoked immediately (tokens live up to an hour).

## Decision

1. `operators/{firebaseUid}` in Firestore is the authoritative authorization
   record with one lifecycle (`pending`, `active`, `suspended`, `rejected`,
   `revoked`) and one of the existing roles. Claims are no longer consulted.
2. `FirebaseOperatorDirectory` verifies the token (authentication) and reads
   the account on every request (authorization). Only `active` → principal.
3. `AccessService` is the only writer; administrators (`manage_access`,
   admin only) approve/reject/suspend/reactivate/revoke/change roles through
   Control Plane commands. Self-changes are refused; roles cannot exceed the
   grantor's rank.
4. Mutations are Firestore transactions with a revision check and an atomic
   active-administrator counter (last administrator cannot be removed).
5. The first administrator is provisioned by a trusted server-side tool
   (`npm run admin:bootstrap`, UID from a server-side env var), guarded by a
   one-time lock document. No UID/email in source; no `VITE_*` configuration.
6. `GET /api/me/access` lets an authenticated-but-unauthorized user learn
   their state; it records a pending request and grants nothing.

## Consequences

- Suspension/revocation are effective on the next request.
- One extra Firestore document read per API request.
- No migration: no claims existed. Existing Firebase identities keep working
  and become pending on first contact.
