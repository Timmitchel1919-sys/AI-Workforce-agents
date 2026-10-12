# ADR-0040: Integration Hub & Tool Ecosystem

## Status

Accepted

## Context

Agents need external capabilities (read a repository, inspect a Firebase project, draft an email,
draft a CMS post) but must never hold provider credentials, speak to providers, or choose which
provider serves them. The platform stays private and single-user: only project isolation applies;
no tenancy, customer organisations, billing, SSO or enterprise RBAC.

## Decision

Agents **request capabilities** (`repository.read`, `deployment.execute`, …). Everything else is
the hub's job:

```
Agent → integration.use tool → CapabilityPort → Tool Gateway
  → resolve provider (project mapping, health, trust, mode, cost, fallback)
  → Layer 7 SecurityGovernor (policy, risk, trust, emergency stop, approval)
  → rate limit / circuit → Credential Vault → connector runtime → provider
  → sanitise → ledger + activity log + unpriced usage → result
```

| Piece | Where | Notes |
| --- | --- | --- |
| Contracts | `contracts/integration-gateway.ts` | Operation classes (READ/DRAFT/WRITE/PUBLISH/SEND/DEPLOY/DELETE), connector states, failure kinds |
| Vault + OAuth/PKCE | `core/integration-gateway/vault.ts` | AES-256-GCM at rest; `use(ref, purpose, fn)` hands a `Secret` to one callback; values are never returned, serialised or logged |
| Declarative connector runtime | `rest.ts` | HTTPS only, host-pinned, redirects refused, path/query built from validated parameters, response size-capped and sanitised |
| Manifests | `manifests.ts` | GitHub, Firebase, Google Drive/Gmail/Calendar, Slack, Fireflies, WordPress, Figma, Canva. Docker and Blender are declared **boundaries** only |
| Registry | `registry.ts` | Install workflow, versioning, project mappings, tool-trust records |
| Resilience | `resilience.ts` | Token-bucket limiter honouring provider-reported limits, circuit breaker, retries only for idempotent reads |
| Gateway | `gateway.ts` | The single pipeline, sandbox substitution, approval escalation, offline queue |
| Events | `events.ts` | Signed webhooks (GitHub/Slack/Fireflies/generic HMAC), replay protection, normalised events, subscriptions that only **propose** work |
| MCP | `mcp.ts` | Servers register as PENDING_REVIEW; each tool becomes `mcp.<server>.<tool>` and passes the same pipeline; unmarked tools are treated as side-effecting |
| Control + HTTP | `control/services/integration-control-service.ts`, `/integration-center/*`, `integration_*` commands, public `POST /integrations/webhooks/:connectorId` | `manage_integrations` capability; credential, enable, LIVE mode, trust increase, MCP registration are administrator-only |

## Safety properties (enforced and tested)

- No agent/prompt/runtime module contains an HTTP client, provider URL or provider secret (static test).
- A credential is sent only in the provider request, only to the pinned host.
- Sandbox mode never performs a side effect; `email.send` is substituted by a draft, and the result
  discloses the substitution.
- PUBLISH/SEND/DEPLOY/DELETE always require approval; a WRITE needs approval unless the connector is
  TRUSTED and the policy engine allows it. Approvals are bound to the request fingerprint.
- A project can use only connectors mapped to it, and an agent only on its assigned projects.
- A webhook is authenticated by its HMAC signature, is replay-protected, and never starts work.
- Disabled/suspended connectors, the emergency stop and an unreviewed MCP server all fail closed.

## Consequences / honest limits

- **No provider integration has been verified against a live account.** Manifests are written from the
  providers' documented APIs and tested with a recording fake transport. Each connector stays
  disconnected until the owner stores a credential and passes the install workflow.
- Firebase `deployment.*` depends on a `DeploymentExecutor` which production does not configure; the
  capabilities exist but report themselves unavailable.
- Native OAuth requires the owner to register the app with each provider and set the
  `*_OAUTH_CLIENT_ID/SECRET` environment variables on the server. A pasted access token also works but
  cannot be refreshed.
- The queue is drained on request (`integration_drain_queue`); there are no background timers.
- Provider usage is recorded as **unpriced** usage; no cost is invented.
- No real MCP server is bundled. Docker and Blender are declared boundaries, not implementations.
- Security Agent / AI Auditor integration is alert- and ledger-based (`integration.*`, `tool.*`,
  `credential.*`, `webhook.*` operations), not a separate scanner.
