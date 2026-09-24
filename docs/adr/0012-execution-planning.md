# ADR-0012: Execution planning foundation (EO-3.1)

- Status: Accepted
- Date: 2026-09-23

## Context

Environment orchestration (EO-1/EO-2A) can describe environment types and
record detected instances, and route a single requirement. The workforce had no
way to turn a project's requirements into a complete, explainable description
of intended work — and no Task Analyzer, Project Architect or Model Router
existed. Execution itself (EO-4) must not start before planning is trustworthy.

## Decision

1. Add a planning layer (`contracts/planning.ts`, `core/planning/`) that
   produces a versioned, validated `ExecutionPlan` and **never executes**.
2. Task analysis is deterministic: structured `ProjectRequest` + a declarative
   technology catalog. No model calls; free text is not parsed.
3. Reuse EO-2A instead of duplicating it: `EnvironmentRouter.evaluate()` adds
   explainable evidence (and `route()` delegates to it);
   `AgentQualificationRouter.evaluateCandidates()` adds strict planning-time
   qualification. The router now enforces toolchain minimum versions and
   components (a latent EO-2A gap).
4. Model eligibility comes from declared `ModelCapabilityProfile`s matched
   against the agent's provider-neutral `modelPolicy`. No profile → blocker.
5. Blocked is a valid planning outcome with structured blockers, not an error.
6. Plans are immutable versions (`${planId}@v${n}`); replanning creates a new
   version and supersedes the previous one. Current = highest version.
7. Approval reuses the `ApprovalSystem` and the existing approve/reject
   commands; approval changes governance state only.
8. Persistence reuses `FirebaseRepositoryProvider` (collection
   `execution_plans`); no Firestore types in the domain; no new indexes (the
   repository is hydrate-once, see ADR-0011).
9. The Control Plane gains three commands and two nested project routes; no
   execution route. Viewers read, operators/admins plan.

## Consequences

- Every production plan is `blocked` until real hosts/instances, qualified
  agents and model profiles are registered — deliberately honest.
- The EO-2A router may now refuse an instance whose toolchain is older than a
  requirement's minimum, or choose a higher-trust instance when several
  qualify.
- Multi-instance consistency inherits the hydrate-once cache limitation of
  ADR-0011; concurrent replans across function instances are addressed in
  EO-3.2.
