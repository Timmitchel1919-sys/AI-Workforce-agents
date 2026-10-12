# AI Workforce — Security Center, Alert Engine & Incident Management

## 1. Overview & Purpose

The **AI Workforce Security Center** is the centralized security operations and posture management command center for the AI Workforce OS platform. Modeled on familiar Windows Security and enterprise SIEM operations consoles, it provides administrators and SecOps teams with real-time, authoritative visibility into:

- **Overall Security Posture & Deterministic Score (0–100)**
- **13 Canonical Security Domains** (from Identity & Access to Software Supply Chain and Recovery)
- **Active & Historical Security Alerts** with automatic deduplication
- **Security Incident Management Lifecycle** with immutable audit timelines and resolution requirements
- **Actionable Deterministic Recommendations**
- **Human-in-the-Loop Destructive Action Approval Gate**
- **Notification Seams** for future multi-channel dispatch (Email, WhatsApp, Push)

### Design & Architectural Principles
1. **Server-Side Authoritative Enforcement:** The Security Center UI is strictly a presentation and interaction layer. It never computes security postures or bypasses access controls. All policies, posture scoring, deduplication, and capability gates execute on the Control Plane backend.
2. **Deterministic Posture Scoring:** Posture scores and domain statuses are calculated using deterministic rules without AI inference, ensuring explainable, repeatable, and non-hallucinatory SecOps metrics.
3. **Defense-in-Depth & Data Redaction:** Raw credentials, tokens, private keys, and sensitive authorization headers are automatically redacted by the `SecretRedactor` pipeline before entering alert evidence or UI payloads.
4. **Immutable Audit Timelines:** Neither alerts nor incidents can overwrite or purge audit events or historical resolution records upon dismissal, resolution, or reopening.
5. **Fail-Degraded Telemetry:** If security telemetry providers or event stores fail, the Security Center degrades its posture score and displays a prominent warning rather than falsely declaring "All Secure."

---

## 2. High-Level Architecture & Event Pipeline

```
+-----------------------------------------------------------------------------------+
|                            Security Telemetry Sources                             |
|  - ZTNSecurityEvents (Auth, Policy, Data Integrity)                               |
|  - Destructive Action Interceptions                                               |
|  - Backup & Recovery Verification Findings                                        |
|  - Software Supply Chain / SAST / License Scans                                   |
|  - Secret Vault Leaks & Rotation Alerts                                           |
+-----------------------------------------------------------------------------------+
                                        |
                                        v
+-----------------------------------------------------------------------------------+
|                        Deterministic Alert Engine                                 |
|  - Domain & Severity Classification                                               |
|  - Time-Window Deduplication (1-hour sliding window per event/domain/target/actor)|
|  - Secret Redaction & Evidence Sanitization                                       |
|  - Auto-Escalation of Critical/Privileged Threats                                 |
+-----------------------------------------------------------------------------------+
              |                                                   |
              v                                                   v
+----------------------------+                     +-------------------------------+
|      Security Alerts       |                     |    Security Incident Service  |
|  - Open / Acknowledged     |                     |  - Open / Triaged / Contained |
|  - Investigating / Resolved| <------------------ |  - Immutable Audit Timelines  |
|  - Dismissed (Audited)     |   (Link Alerts)     |  - Mandatory Resolution Note  |
+----------------------------+                     |  - Reopen History Integrity   |
              |                                    +-------------------------------+
              \_________________                 ________________/
                                \               /
                                 v             v
                     +-----------------------------------+
                     |      SecurityCenterService        |
                     |  - Deterministic Posture Scorer   |
                     |  - 13 Domain Posture Evaluators   |
                     |  - Project Isolation Enforcement  |
                     |  - Deterministic Recommendations  |
                     +-----------------------------------+
                                       |
                                       v
                     +-----------------------------------+
                     |         Security Center API       |
                     |     /api/security/summary         |
                     |     /api/security/alerts          |
                     |     /api/security/incidents       |
                     +-----------------------------------+
                                       |
                                       v
                     +-----------------------------------+
                     |         Security Center UI        |
                     |  (Dark Bento / Liquid Glass OS)   |
                     +-----------------------------------+
                                       |
                                       v
                          Human Security Operator
```

### Outbound Seam: Future Autonomous Capabilities
```
Alert Engine / Incident Service
        |
        +---> SecurityAlertPublisher (Notification Seam)
        |          |--> In-App Notifications (Active V1)
        |          |--> Future: Email (Step 11+)
        |          |--> Future: WhatsApp / Push (Step 11+)
        |
        +---> Future: Security Agent (Step 11)
                   |--> Autonomous correlation & root-cause analysis
                   |--> Proactive remediation recommendations
```

---

## 3. Posture Model & Deterministic Scoring

The posture model evaluates 13 canonical security domains defined in `contracts/security-center.ts`:

| Domain | Scope & Description | Initial Telemetry Status |
| :--- | :--- | :--- |
| `identity_access` | Authentication events, RBAC denials, session boundaries | Active |
| `application_api` | API abuse, rate-limiting, anomalous access patterns | Active |
| `agent_security` | AI agent sandbox boundaries, prompt injection traps | Active |
| `secrets` | Secret Vault access, leaks, credential rotation status | Active |
| `data_integrity` | Audit log tamper attempts, cryptographic signature checks | Active |
| `destructive_actions`| Intercepted destructive actions, human approval gates | Active |
| `software_supply_chain`| SAST findings, dependency vulnerabilities, lockfile validation | Active |
| `backup_recovery` | Backup catalog staleness, recovery drill verifications | Active |
| `policy_governance` | Security Policy Engine rules, zero-trust boundary events | Active |
| `integration_security`| Third-party API adapter security and credential scopes | Active |
| `cloud_edge` | Cloud Armor / WAF edge protection | Unconfigured (`unknown`) |
| `email_phishing` | Inbound phishing and email threat detection | Unconfigured (`unknown`) |
| `endpoint_security` | OS and host-level endpoint telemetry | Unconfigured (`unknown`) |

### Deterministic Score Calculation
The overall security score begins at **100** and subtracts deterministic penalties based on open findings:
- **-25** points per unresolved `critical` alert
- **-12** points per unresolved `high` alert
- **-5** points per unresolved `medium` alert
- **-1** point per unresolved `low` alert
- **-20** points per active `critical` incident
- **-35** points if telemetry health is degraded (`telemetryHealthy === false`)

The score is clamped to `[0, 100]` and mapped to the overall posture status:
- **90–100:** `secure` (All systems operational within normal limits)
- **70–89:** `attention` (Elevated or medium findings requiring review)
- **40–69:** `degraded` (High-severity findings or compromised telemetry)
- **0–39:** `critical` (Critical breaches, open critical incidents, or urgent leaks)

---

## 4. Alert Engine & Deduplication

Located in `core/security/alert-engine.ts`, the `AlertEngine` ingests `ZTNSecurityEvent`s and performs:
1. **Rule-Based Classification:** Matches event types and descriptions to security domains and severities.
2. **Sliding-Window Deduplication:** Repeated identical events occurring within a 1-hour window (matching `${eventType}:${domain}:${target}:${principal}`) do not produce duplicate alerts. Instead:
   - The existing alert's `eventCount` is incremented.
   - `lastObservedAt` is updated to the latest timestamp.
   - The new `eventId` is appended to `sourceEventIds`.
   - If repeated event counts exceed thresholds (e.g. 5 repeated auth failures), the alert's severity escalates automatically.
3. **Secret Redaction:** Any telemetry description or evidence containing API keys, private keys, passwords, or bearer tokens is sanitized via `SecretRedactor` before being stored.
4. **Auto-Incident Escalation:** All `critical` alerts automatically create a corresponding `SecurityIncident` via the `SecurityIncidentService`.

---

## 5. Security Incident Management Lifecycle

Located in `core/security/security-incident-service.ts`, the incident lifecycle enforces enterprise rigor:
- **Statuses:** `open` -> `triaged` -> `investigating` -> `contained` -> `recovering` -> `resolved` -> `closed`
- **Immutable Timeline:** Every transition (creation, alert attachment, owner assignment, containment start, resolution, reopening) generates a permanent timeline record.
- **Resolution Governance:** Resolving an incident requires a mandatory detailed resolution summary (minimum 15 characters) and resolver identification.
- **Reopening Auditing:** If an incident is reopened, the previous resolution summary is preserved in the timeline alongside the operator's justification.

---

## 6. Access Control & Capability Enforcement

The Security Center API enforces the principle of least privilege using Control Plane capabilities:

| Capability | Allowed Actions |
| :--- | :--- |
| `view_security` | View posture summary, domains, recommendations, alert lists, incident summaries |
| `view_security_events`| View raw underlying event details, source event IDs, sanitized telemetry evidence |
| `manage_security_incidents`| Acknowledge/dismiss alerts, assign incidents, change statuses, resolve/reopen incidents |

### Project Scoping & Isolation
- **Project-Scoped Operators:** Operators assigned to a specific `projectId` can only query and view alerts and incidents belonging to their assigned project.
- **Global Platform Alerts:** Platform-level alerts (such as core infrastructure breaches, vault failures, or audit tampering) that lack a `projectId` are strictly restricted to global viewers (`admin` and `super_admin`) and are never leaked to project-scoped users.

---

## 7. Security Center HTTP API

The following REST endpoints are exposed via `api/http-api.ts`:

- `GET /api/security/summary` — Returns overall score, status, banner, and summary metrics.
- `GET /api/security/domains` — Returns posture evaluations for all 13 domains.
- `GET /api/security/recommendations` — Returns actionable deterministic recommendations.
- `GET /api/security/alerts` — Filterable by `severity`, `status`, `domain`, and `projectId`.
- `GET /api/security/alerts/:id` — Returns single alert with evidence details.
- `POST /api/security/alerts/:id/acknowledge` — Marks alert as acknowledged.
- `POST /api/security/alerts/:id/dismiss` — Audited dismissal requiring `{ reason }`.
- `GET /api/security/incidents` — Filterable by `severity`, `status`, `domain`, and `projectId`.
- `GET /api/security/incidents/:id` — Returns incident detail with audit timeline and notes.
- `POST /api/security/incidents/:id/assign` — Assigns owner `{ owner }`.
- `POST /api/security/incidents/:id/status` — Updates status with optional note `{ status, note? }`.
- `POST /api/security/incidents/:id/resolve` — Resolves incident `{ summary, rootCause? }`.
- `POST /api/security/incidents/:id/reopen` — Reopens incident `{ reason }`.
- `POST /api/security/incidents/:id/notes` — Adds an investigation note `{ note }`.

---

## 8. Notification Engine Seam

Defined in `core/security/alert-publisher.ts`, the `SecurityAlertPublisher` decouples notification policies from delivery implementations:
- **`critical`:** Emitted to `["in-app", "email", "whatsapp", "push"]`.
- **`high`:** Emitted to `["in-app", "email"]`.
- **`medium` / `low` / `info`:** Emitted to `["in-app"]`.

In Step 10, the `InMemoryAlertPublisher` acts as the verified in-process seam. External transports (SendGrid, WhatsApp Cloud API, WebPush) are reserved for future notification plugins.

---

## 9. Current Limitations & Future Roadmap

- **No Autonomous Threat Mitigation (Reserved for Step 11):** Incidents currently require human-in-the-loop triage, containment, and resolution.
- **No External Push/SMS Integrations:** Notification seams publish events internally; external transport delivery is not configured in Step 10.
- **Placeholder Unconfigured Domains:** Cloud Edge, Email Phishing, and Endpoint Security report as `unknown / not_configured` pending external SIEM/sensor integrations.
