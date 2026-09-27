# ADR-0025: Project onboarding & provisioning

## Status
Accepted (PROJECT-2)

## Decision
Projects are created through a governed flow, never directly:

`draft → source → analysis → plan → human approval → provisioning → validation → READY`

- **Onboarding session** (`onboarding_sessions`, revision-CAS in Firestore) holds the draft, analysis, versioned plan, approval and step ledger. A deterministic state machine lives in `contracts/onboarding.ts`.
- **Discovery** (`core/onboarding/discovery.ts`) is pure and read-only: it works on evidence (file listing + allow-listed manifests) and reports only evidenced facts; unknowns go to `unavailable`. Env vars are captured as names only.
- **Repository access** is a read-only `RepositorySourceReader`. GitHub is the only implementation; credentials are server-side only (`AI_WORKFORCE_GITHUB_READ_TOKEN`), never in the UI, URLs or responses. Without a credential, only public repositories are readable and this is stated honestly.
- **Plan** (`planner.ts`) is immutable and hash-bound; an approval binds to `planHash`, so any edit invalidates it.
- **Provisioning** (`ProjectProvisioningService`) is idempotent, step-tracked and resumable, never compensates by deleting, and only runs steps that are truly executable. Repository creation and Firebase project creation are `requirement_pending` — not implemented, never faked.
- **READY gate**: mandatory validation checks must pass; only then is the project registered in the existing `ProjectRegistry` (so Projects and the Spatial Graph see it). Other instances re-hydrate READY projects from `provisioned_projects`.
- **Authorization**: new `create_project` capability (admin only, and only unscoped operators). Sessions/projects are written only by the Control Plane; Firestore rules stay deny-all.

## Known gaps (reported, not hidden)
Local import (needs a Desktop Agent bridge), GitHub repository creation, Firebase auto-provisioning, AI Cost Center enforcement (policy is recorded, not enforced), execution of agents/objectives (future Software Factory layer).
