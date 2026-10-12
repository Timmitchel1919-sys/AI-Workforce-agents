# API Security Middleware & Request Protection

This document outlines the API security layer in front of the AI Workforce Control Plane and privileged backend endpoints.

## Request Security Pipeline

Incoming API requests follow this lifecycle:

1. **Internet / Client**
2. **API Security Layer** (`api/security/middleware.ts`)
   - **Security Headers**: Injects `X-Content-Type-Options`, `X-Frame-Options`, `Content-Security-Policy`, and HSTS.
   - **CORS**: Validates origins and rejects unexpected credentialed cross-origin requests.
   - **Rate Limiting**: Checks `RateLimitProfile` based on authentication and IP signatures.
   - **Authentication**: Validates Bearer tokens and rejects invalid/expired credentials.
   - **Context Initialization**: Assigns Correlation IDs and generates the `SecureRequestContext`.
3. **Authorization** (`api/security/authorization.ts`)
   - Uses `requireAuthenticatedRequest`, `requireCapability`, and `requireProjectAccess` to enforce RBAC using the authoritative `OperatorPrincipal`.
4. **Validation** (`api/security/validation.ts`)
   - Enforces `application/json` Content-Types.
   - Enforces explicit body size limits (`maxBytes`) and JSON schema validation.
5. **Service execution**
   - Commands and queries execute safely against backend domains.
6. **Audit / Security Events**
   - Audit logs and security events receive the preserved correlation ID and deterministic outcomes.

## Key Features

### Authentication & Authorization
Uses the Firebase `IdentityVerifier` architecture as the single source of truth for token resolution. Client-supplied role definitions are ignored. The `OperatorDirectory` translates verified UIDs into `OperatorPrincipal` structures.

### Fail-Closed Behavior
If any security dependency (like identity resolution or the policy engine) fails or cannot verify a request, the system defaults to a **Fail-Closed** behavior. The route will return a structured 401, 403, or 500 without processing the mutation.

### Rate Limiting
Application-level rate limiting (`RATE_LIMIT_PROFILES`) is enforced via `checkRateLimit` based on the request type (e.g., `AUTHENTICATION`, `PRIVILEGED_MUTATIONS`, `DESTRUCTIVE_ACTIONS`). This provides a secondary layer to frontend throttling.

### Correlation IDs
Every request relies on a uniquely generated or securely inherited `correlationId`. This binds the initial API request to the backend execution, audit trail, and any security events.

### App Check Seam
Prepared an `AppAttestationVerifier` seam to support Firebase App Check. Privileged production enforcement will be fully implemented in Step 6 (Firebase Security Hardening).

## Safe Error Model
To prevent leaking sensitive information, raw authorization internals and stack traces are suppressed. Structured error responses use deterministic codes:
- `400 invalid_request`
- `401 unauthenticated`
- `403 forbidden`
- `405 method_not_allowed`
- `413 payload_too_large`
- `415 unsupported_media_type`
- `429 rate_limited`
- `500 internal_error`

## Limitations & External Controls
This API middleware does **NOT** replace:
- Firebase Security Rules (Firestore / Storage)
- WAF / Cloud Armor protections
- The Security Policy Engine or Destructive Action Approvals

## Recommended Next Step
**SECURITY FOUNDATION V1 STEP 6 — FIREBASE SECURITY HARDENING: FIRESTORE RULES, STORAGE RULES & APP CHECK**
