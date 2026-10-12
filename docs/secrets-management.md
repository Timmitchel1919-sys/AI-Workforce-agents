# Secrets Management, Credential Vault & Key Rotation Architecture

## 1. Overview & Core Invariants

The AI Workforce platform enforces a strict boundary between application data and sensitive credentials. 

```
User / Agent / Service
      ↓ (Purpose-bound SecretAccessRequest)
Control Plane / Security Policy Engine
      ↓ (SecretAccessDecision)
SecretReference Resolver (Metadata Store)
      ↓ (SecretReference ID)
Vault Provider (DevelopmentEnv / GoogleSecretManager)
      ↓ (Scoped Ephemeral SecretValue)
Action Execution (Tool / Provider / Deployment)
      ↓
Secret Value Discarded from Memory
      ↓
Immutable Audit Metadata Logged
```

### Core Invariants

1. **Secret Value ≠ Application Data**: Raw credentials (API keys, OAuth secrets, private keys, database passwords) must never be stored in application state, logs, Firestore documents, or frontend bundles.
2. **References Over Values**: System components store and pass `SecretReference` metadata records (`id`, `provider`, `kind`, `scope`, `projectId`, `secretName`, `version`, `status`). `SecretReference` objects NEVER contain raw secret values.
3. **No Direct Agent Secret Access**: Raw secrets are never exposed to AI agents. Agents request action execution through validated tools. The tool layer resolves credentials internally via the Vault, executes the operation, and returns the result—not the secret.
4. **Deny Direct Browser Access**: Web clients (`ui/`) and end-user identities (`actorType === 'user'`) are ALWAYS DENIED raw secret resolution.
5. **Purpose-Bound Access**: Every secret resolution request requires a valid, declared `purpose` (`call_model_provider`, `runner_execution`, `deploy_release`, `github_push`, `webhook_validation`, `firebase_admin_operation`, `emergency_break_glass`).
6. **Non-Serializable `SecretValue`**: Secret strings are wrapped in a `SecretValue` abstraction with non-enumerable properties that return `[REDACTED_SECRET_VALUE]` for `toJSON()`, `toString()`, and Node `util.inspect()`.

---

## 2. Public Configuration vs Privileged Secrets

| Data Category | Examples | Handling Strategy |
| :--- | :--- | :--- |
| **Public Configuration** | Firebase API Key (`VITE_FIREBASE_API_KEY`), App Check Site Key (`VITE_FIREBASE_APP_CHECK_SITE_KEY`), Project ID, Endpoint URLs | Stored in client environment (`ui/.env`); bundled in web application assets. Considered public identifiers. |
| **Privileged Secrets** | Anthropic API Key, OpenAI API Key, Service Account JSON Keys, GitHub Tokens, Database Credentials, Webhook Signing Secrets | Stored in Secret Vault (`GoogleSecretManagerProvider` or `DevelopmentEnvSecretProvider`); never exposed to client bundles. |

---

## 3. SecretReference Model & Provider Abstraction

### `SecretReference` Metadata Contract ([`contracts/secrets.ts`](file:///c:/Users/Administrator/Downloads/AI%20Webapp%20Projects/Ai%20worforce%20agents/contracts/secrets.ts))

```ts
export interface SecretReference extends Entity {
  id: string;
  provider: string; // 'env' | 'gcp_secret_manager' | 'test'
  kind: SecretKind;
  scope: SecretScope;
  projectId?: string;
  environment?: string;
  secretName: string;
  version?: string;
  status: "active" | "suspected_leak" | "compromised" | "disabled" | "deprecated";
  createdAt: string;
  updatedAt: string;
  rotationPolicyId?: string;
}
```

### Provider Abstraction Interface (`core/secrets/secret-provider.ts`)

```ts
export interface SecretProvider {
  readonly name: string;
  getSecret(ref: SecretReference): Promise<SecretValue>;
  putSecret?(ref: SecretReference, value: string): Promise<SecretReference>;
  rotateSecret?(ref: SecretReference, newValue: string): Promise<SecretReference>;
  disableVersion?(ref: SecretReference, version: string): Promise<void>;
}
```

- **`DevelopmentEnvSecretProvider`**: Server-side local development provider reading from `process.env`. Fails closed in production.
- **`GoogleSecretManagerProvider`**: Production provider using `@google-cloud/secret-manager` with Application Default Credentials (ADC) / Workload Identity.
- **`TestSecretProvider`**: In-memory provider for unit tests.

---

## 4. Governed Secret Rotation & Exposure Response

### Governed Manual Rotation Flow

1. Rotation request initiated by authorized operator via `SecretControlService`.
2. New secret version pushed to Vault provider.
3. Credential validator tests new secret version.
4. On validation success, `SecretReference` version is updated.
5. Old version is disabled in provider when safe.
6. `secret_rotation_succeeded` audit event emitted.
7. If validation fails, old credential stays active and `secret_rotation_failed` event is logged.

### Secret Exposure Response Flow

1. Secret exposure report submitted (`reportExposure()`).
2. SecretReference status updated to `compromised` or `suspected_leak`.
3. Vault cache cleared.
4. `HIGH` / `CRITICAL` ZTN `SecurityEvent` emitted.
5. Normal policy access blocked until rotation or emergency break-glass authorization.

---

## 5. Automated Secret Scanning & CI Integration

- Scanner script: `scripts/secret-scanner.mjs` (`npm run scan:secrets`).
- Checks repository source files for high-confidence pattern matches (RSA/EC private keys, live Anthropic/OpenAI keys, GitHub PATs, service account JSON).
- Automatically runs in CI (`npm run check`).

---

## 6. Migration & Rollout Safety

1. Perform secret usage audit (`npm run scan:secrets`).
2. Register `SecretReference` metadata in vault store.
3. Configure `GoogleSecretManagerProvider` in production environment using GCP Workload Identity.
4. Verify tool execution using vault-resolved ephemeral credentials.
5. Deprecate legacy environment variables once vault path is verified.
