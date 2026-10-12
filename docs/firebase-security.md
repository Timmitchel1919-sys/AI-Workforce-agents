# Firebase Security Architecture & Hardening Guide

## 1. Overview & Trust Boundaries

The AI Workforce platform implements defense-in-depth security around Firebase infrastructure. 

```
Browser / Client (ui/)
      ↓
Firebase Authentication (ID Tokens)
      ↓
Firebase App Check (reCAPTCHA Enterprise)
      ↓
Control Plane Security Layer (api/security/)
      ↓
Control Plane Services (control/ & core/)
      ↓
RBAC / Project Scope / Policy Engine / Approval Gates
      ↓
Firebase Adapters & Admin SDK (adapters/firebase/)
      ↓
Firestore / Storage (Server-Side Only)
```

### Core Invariants

1. **Deny Direct Access by Default**: Browser clients and unauthenticated scripts are denied direct read/write access to Firestore databases and Firebase Storage buckets.
2. **Authentication Is Not Authorization**: Firebase Authentication verifies user identity only. Authorization (operator status, role, allowed projects, capabilities) is determined exclusively server-side by the Control Plane.
3. **Server-Only Privileged State**: Operator accounts, role assignments, audit logs, security policies, approval states, and destructive action records are authoritative server records and cannot be forged or mutated by browser clients.
4. **App Check Defense-in-Depth**: Firebase App Check verifies that inbound requests to the Control Plane API originate from legitimate, non-tampered web application clients. App Check attestation works alongside Firebase Auth and RBAC, never replacing them.
5. **Signed URLs Only for Media/Assets**: Storage objects (user avatars, project assets, audit evidence, backups) are accessed only via short-lived signed URLs generated server-side by the Control Plane.

---

## 2. Resource Classification Matrix

### Firestore Collections

| Collection Family | Classification | Client Direct Read | Client Direct Write | Primary Authority |
| :--- | :--- | :--- | :--- | :--- |
| `operators` | SERVER-ONLY | DENIED | DENIED | Control Plane `FirestoreOperatorAccountStore` |
| `access_control` | SERVER-ONLY | DENIED | DENIED | Control Plane `AccessService` |
| `operator_profiles` | SERVER-ONLY | DENIED | DENIED | Control Plane `ProfileService` |
| `audit_events` / `audit_logs` | SERVER-ONLY | DENIED | DENIED | Control Plane `AuditLog` (Append-only) |
| `security_events` | SERVER-ONLY | DENIED | DENIED | Control Plane `SecurityControlService` |
| `control_events` | SERVER-ONLY | DENIED | DENIED | Control Plane `FirestoreEventPublisher` |
| `security_policies` / `zero_trust_policies` | SERVER-ONLY | DENIED | DENIED | Control Plane `GovernancePolicyEngine` |
| `approvals` | SERVER-ONLY | DENIED | DENIED | Control Plane `ApprovalSystem` |
| `destructive_actions` | SERVER-ONLY | DENIED | DENIED | Control Plane `DestructiveActionGate` |
| `projects` / `provisioned_projects` | SERVER-ONLY | DENIED | DENIED | Control Plane `ProjectProvisioningService` |
| `agents` / `agent_operations` | SERVER-ONLY | DENIED | DENIED | Control Plane `AgentOperationalStore` |
| `tasks` / `workflows` | SERVER-ONLY | DENIED | DENIED | Control Plane `TaskSystem` / `WorkflowEngine` |
| `execution_*` | SERVER-ONLY | DENIED | DENIED | Control Plane `ExecutionPlanningService` |
| `software_factory_*` | SERVER-ONLY | DENIED | DENIED | Control Plane `SoftwareFactoryOrchestrator` |

### Firebase Storage Paths

| Storage Path | Classification | Client Direct Read | Client Direct Write | Access Strategy |
| :--- | :--- | :--- | :--- | :--- |
| `/avatars/{uid}` | SERVER-ONLY | DENIED | DENIED | Control Plane Signed URLs |
| `/project-assets/{projectId}/*` | SERVER-ONLY | DENIED | DENIED | Control Plane Signed URLs |
| `/uploads/*` | SERVER-ONLY | DENIED | DENIED | Control Plane Signed URLs |
| `/security-evidence/*` | SERVER-ONLY | DENIED | DENIED | Control Plane Signed URLs |
| `/backups/*` | SERVER-ONLY | DENIED | DENIED | Server-Side Only |
| `/exports/*` | SERVER-ONLY | DENIED | DENIED | Control Plane Signed URLs |

---

## 3. Firebase App Check Architecture

### Client Integration (`ui/src/auth/appCheck.ts`)

Web clients initialize App Check using the official Firebase Web SDK (`firebase/app-check`) with reCAPTCHA Enterprise:

- Site Key provided via `VITE_FIREBASE_APP_CHECK_SITE_KEY`.
- Token provider auto-refreshes tokens and attaches `X-Firebase-AppCheck` header to all `apiRequest()` calls via `setAppCheckTokenProvider`.
- Local development supports debug tokens using `VITE_FIREBASE_APPCHECK_DEBUG_TOKEN` or explicit dev mode flag.

### Server Attestation Verification (`api/security/app-check.ts` & `middleware.ts`)

The Control Plane API verifies incoming App Check tokens using `FirebaseAppAttestationVerifier` via `firebase-admin/app-check`.

### Enforcement Modes

Configured via `APP_CHECK_ENFORCEMENT_MODE`:

1. `disabled`: App Check verification is bypassed (for local testing/CI).
2. `monitor`: Verification runs, failures populate request context and log security telemetry, but requests are not rejected.
3. `enforced`: Protected production routes require valid App Check attestation; invalid or missing tokens fail closed with status `401` / `app_check_denied`.

---

## 4. Admin SDK & Credential Boundaries

- `firebase-admin` is loaded lazily only in `adapters/firebase/firebase-services.ts`.
- The browser UI package (`ui/`) does not import or bundle `firebase-admin`.
- Service-account credentials (`GOOGLE_APPLICATION_CREDENTIALS`) are stored outside source control and read strictly at server startup.

---

## 5. Security Rules Verification & Testing

Rules unit tests (`tests/firebase-security-rules.test.ts`) verify that:

- `firestore.rules` and `storage.rules` maintain `rules_version = '2'`.
- Fallback matches (`/{document=**}` and `/{allPaths=**}`) enforce `allow read, write: if false;`.
- No broad `request.auth != null` rules exist.
- All collection and path access scenarios fail closed.

Full security chain integration tests (`tests/firebase-security-chain.test.ts`) verify end-to-end enforcement across Auth, App Check, RBAC, and Project Isolation.

---

## 6. Production Deployment Safety & Rollout Plan

Before deploying updated security rules to production:

1. Execute full local verification: `npm run check`.
2. Run rule security test suite: `node --test dist/tests/firebase-security-rules.test.js`.
3. Validate client app functionality against Firebase Local Emulator (`firebase emulators:start`).
4. Set `APP_CHECK_ENFORCEMENT_MODE=monitor` in staging to verify token generation.
5. Promote `APP_CHECK_ENFORCEMENT_MODE=enforced` in production once staging metrics validate attestation rate.
6. Deploy rules via governed deployment: `firebase deploy --only firestore:rules,storage:rules`.
