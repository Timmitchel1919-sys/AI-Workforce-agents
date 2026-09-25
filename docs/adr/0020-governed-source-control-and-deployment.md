# ADR-0020: Governed source control and deployment orchestration (EO-4.6)

- Status: Accepted
- Date: 2026-09-24

## Context

Verified ChangeSets (EO-4.4) must be able to become commits, pushes and
releases without a general git or deploy interface. Each of these steps must
stay separately governed and must never be inferred from the previous one.

## Decision

1. `SourceControlOrchestrator` exposes typed commands only: review, prepare
   stage set, commit and push.
   - Each command re-checks verification, source fingerprint, review
     independence and an approval bound to that exact subject.
   - Git runs behind `GovernedGitAdapter`: fixed hardened templates,
     path-limited staging, a system-built commit message, and fast-forward-only
     push to the configured remote.
   - There is no force, raw-argument or URL input anywhere.
2. Branch policy decides where a commit goes. Protected branches are reached
   through a working branch and a pull request, never bypassed.
3. `DeploymentOrchestrator` deploys immutable candidates to registered targets.
   - Each target class has its own requirements (production needs a bound
     approval).
   - Deploys hold a per-target lock and are time-bounded.
   - HEALTHY requires reachable **and** version equal to the candidate commit.
   - Rollback restores the last known healthy release and needs approval.
4. Approvals reuse the existing Approval system with a canonical binding in
   metadata (project, action, subject, source, commit, branch, target).
5. Receipts (commit, push, release) are immutable, credential-free and
   policy-versioned. Every transition is audited.

## Consequences

- WRITE ≠ STAGE ≠ COMMIT ≠ PUSH ≠ DEPLOY ≠ HEALTHY is enforced in code and
  tests.
- Only a test deployment adapter exists. Real providers (Firebase, container,
  mobile, desktop, game) must implement the bounded `DeploymentAdapter`
  contract before they can be used.
- Records are in memory in this phase. Durable persistence is a later step.
