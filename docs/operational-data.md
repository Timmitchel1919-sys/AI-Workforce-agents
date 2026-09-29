# Operational Data Foundation

The operational data foundation records **observations** and **actual
outcomes**. It is not a forecasting engine and never fabricates historical
data, confidence, or predictions.

## Data flow

```text
Core audit event
  -> OperationalAuditSink
  -> immutable OperationalEvent (project-scoped, redacted, provenance-bound)
  -> readiness assessment
  -> future analytics / advisory intelligence only when ready
```

`OperationalOutcome` records an actual result such as a delivery, capacity,
cost, failure-risk, or reliability outcome. An outcome is not an estimate.

## Safety invariants

- Every record requires a `projectId`; events without a project boundary are
  ignored by the audit bridge.
- Records are immutable. A duplicate id is rejected rather than overwritten.
- Provenance identifies the source and optional correlation/revision.
- Dimension and actual-value fields accept only scalar values and reject
  sensitive key names such as token, secret, password, credential, API key,
  and authorization.
- No global readiness state exists. Readiness is evaluated per project and
  per domain.

## Readiness

`OperationalDataSystem.assessReadiness()` returns `ready`, `limited`,
`not_ready`, or `unknown`.

There are no global magic thresholds. A caller must supply a domain-specific
`DataReadinessPolicy` before an assessment can be `ready`. Without one, the
result is `unknown`. A project with no events is `not_ready`; partial evidence
is `limited`. This prevents an empty dataset from becoming a zero-valued
forecast.

## Production persistence

The Control Plane creates Firestore-backed cached repositories for
`operational_events` and `operational_outcomes`. New project-scoped audit
events are recorded as observations. Historical audit records are not
backfilled automatically: doing so needs an explicit provenance and
data-quality migration.

## Current scope

Implemented:

- immutable operational facts and actual outcomes;
- project isolation and sensitive-key validation;
- domain-specific data readiness;
- audit-to-observation capture;
- deterministic tests.

Not implemented:

- cost ingestion, release outcomes, runner telemetry, or historical backfill;
- metrics aggregation, forecasting, anomaly detection, recommendations, or
  optimization;
- predictive UI or autonomous actions.
