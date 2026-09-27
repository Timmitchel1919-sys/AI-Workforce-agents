/**
 * ProjectProvisioningService (PROJECT-2) — executes an APPROVED plan.
 *
 *   approved plan → step-tracked provisioning → validation → READY
 *
 * Guarantees:
 *  - Provisioning runs only from an immutable, approved plan; the run is bound
 *    to its `planHash`, so a changed plan can never reuse an approval.
 *  - Steps run sequentially and every transition is persisted with an
 *    optimistic-concurrency check, so progress shown to the operator is real
 *    and two concurrent runs cannot both proceed.
 *  - Idempotent: a repeat request for a plan that is already provisioning /
 *    ready is a no-op; a resumed run skips steps already complete; the project
 *    record and its id/code/repository claims are created exactly once.
 *  - Partial failure is recorded, not hidden, and never compensated by
 *    deleting anything: there is no atomicity across external providers.
 *  - Only steps that are genuinely executable here run. External steps
 *    (repository creation, Firebase project creation) stay
 *    `requirement_pending` — they are never faked.
 *  - READY is a gate: mandatory validation checks must pass.
 */
import { type ProjectAdapter } from "../../contracts/index.js";
import type { OnboardingSession, OnboardingSessionStore, ProvisionedProject, ProvisionedProjectStore } from "../../contracts/onboarding.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { ProjectRegistry } from "../registry/project-registry.js";
export interface ProvisioningDeps {
    sessions: OnboardingSessionStore;
    projects: ProvisionedProjectStore;
    registry: ProjectRegistry;
    audit: AuditLog;
    adapterFactory: (project: ProvisionedProject) => ProjectAdapter;
    clock?: () => string;
}
/** A run still marked `provisioning` this long after its last write is stale. */
export declare const STALE_RUN_MS: number;
export declare class ProjectProvisioningService {
    private readonly deps;
    private readonly clock;
    constructor(deps: ProvisioningDeps);
    run(approved: OnboardingSession, actor: string): Promise<OnboardingSession>;
    /** Re-run validation (and, when it passes, activation) for a session. */
    validate(session: OnboardingSession, actor: string): Promise<OnboardingSession>;
    /**
     * Registers a READY-eligible provisioned project in the in-process Project
     * Registry (idempotent). Used after validation and by the startup sync.
     */
    activate(project: ProvisionedProject): void;
    private execute;
    private buildRecord;
    /** AI Auditor baseline: every field is a real value or "Unavailable". */
    private baseline;
    private check;
    private failValidation;
    private startRun;
    private patchStep;
    private transition;
    private save;
    private audit;
}
