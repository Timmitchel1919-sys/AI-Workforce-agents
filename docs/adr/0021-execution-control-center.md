# ADR-0021: Execution Control Center (EO-4.7)

- Status: Accepted
- Date: 2026-09-24

## Context

Operators need authoritative visibility into the execution infrastructure
(EO-3 to EO-4.6) and governed control over it, without a second application,
direct data access or invented telemetry.

## Decision

1. A project **Operations** tab inside the existing Control Center. It reuses
   routing, layout, authentication, the i18n languages (EN and NL) and the
   theme tokens.
2. Read models are built on the server from sessions, receipts, audit,
   verification history, source-control and release receipts, and the
   adapter registry.
   - They are project-scoped (IDOR returns 404), bounded and paginated.
   - Free-form data is redacted.
   - A missing subsystem is reported as `configured: false`.
3. The only mutations are the existing typed, audited `cancel-execution` and
   `kill-execution` commands (kill is scoped to one session and limited to
   administrators). They need a reason and a confirmation dialog, and the UI
   always re-reads state afterwards.
4. The pipeline is derived only from evidence. Pushed is never shown as
   deployed, deployed never as healthy, and production is marked in text.

## Consequences

- Empty and "not configured" states appear in production until real runners,
  repositories and deployment targets are configured. This is intended.
- The client works with polling today and can move to server-sent events or
  WebSockets later without changing the view contracts.
