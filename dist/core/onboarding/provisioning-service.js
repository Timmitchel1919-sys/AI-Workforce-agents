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
import { StateTransitionError, ValidationError, } from "../../contracts/index.js";
import { UNAVAILABLE, canTransitionOnboarding, } from "../../contracts/onboarding.js";
import { parseProjectRepositoryRef, repositoryKey, } from "../registry/project-repository-ref.js";
import { OnboardingConflictError } from "./onboarding-errors.js";
/** A run still marked `provisioning` this long after its last write is stale. */
export const STALE_RUN_MS = 5 * 60_000;
export class ProjectProvisioningService {
    deps;
    clock;
    constructor(deps) {
        this.deps = deps;
        this.clock = deps.clock ?? (() => new Date().toISOString());
    }
    /* -------------------------------------------------------------- */
    /* run                                                            */
    /* -------------------------------------------------------------- */
    async run(approved, actor) {
        const plan = approved.plan;
        const approval = approved.approval;
        if (!plan || !approval || approval.planHash !== plan.planHash) {
            throw new StateTransitionError("the plan changed after approval — review and approve it again");
        }
        if (plan.blockers.length > 0) {
            throw new ValidationError("the approved plan has blockers");
        }
        let current = await this.save(approved, (draft) => {
            this.transition(draft, "provisioning");
            draft.failure = undefined;
            draft.validation = undefined;
            draft.provisioning = this.startRun(draft, plan.steps);
        });
        this.audit(current, actor, "provisioning_started", {
            attempt: current.provisioning.attempt,
            planVersion: plan.planVersion,
        });
        for (const planned of plan.steps) {
            const record = current.provisioning.steps.find((step) => step.key === planned.key);
            if (record.status === "complete" ||
                record.status === "requirement_pending" ||
                record.status === "skipped") {
                continue;
            }
            current = await this.patchStep(current, planned.key, {
                status: "running",
                startedAt: this.clock(),
                error: undefined,
            });
            try {
                const detail = await this.execute(current, planned, actor);
                current = await this.patchStep(current, planned.key, {
                    status: "complete",
                    completedAt: this.clock(),
                    detail,
                });
                this.audit(current, actor, "step_completed", { step: planned.key });
            }
            catch (error) {
                if (error instanceof OnboardingConflictError && error.code === "revision_conflict") {
                    throw error;
                }
                const message = safeMessage(error);
                current = await this.patchStep(current, planned.key, {
                    status: "failed",
                    completedAt: this.clock(),
                    error: message,
                });
                current = await this.save(current, (draft) => {
                    this.transition(draft, "provisioning_failed");
                    draft.failure = {
                        code: error instanceof OnboardingConflictError
                            ? error.code
                            : "step_failed",
                        message,
                        at: this.clock(),
                        step: planned.key,
                    };
                });
                this.audit(current, actor, "step_failed", {
                    step: planned.key,
                    reason: message,
                });
                return current;
            }
        }
        return this.validate(current, actor);
    }
    /** Re-run validation (and, when it passes, activation) for a session. */
    async validate(session, actor) {
        let current = session;
        if (current.status !== "validating") {
            current = await this.save(current, (draft) => {
                this.transition(draft, "validating");
            });
        }
        const report = await this.check(current);
        if (!report.ready) {
            current = await this.save(current, (draft) => {
                this.transition(draft, "validation_failed");
                draft.validation = report;
                draft.failure = {
                    code: "validation_failed",
                    message: `blocked: ${report.blocking.join("; ")}`,
                    at: this.clock(),
                };
            });
            this.audit(current, actor, "validation_failed", {
                blocking: report.blocking,
            });
            return current;
        }
        // Activation. Persist READY first, then make the project discoverable, so
        // this instance never exposes a project whose durable record is blocked.
        const stored = await this.deps.projects.get(current.projectId);
        if (!stored) {
            return this.failValidation(current, actor, report, "project record missing");
        }
        let record = stored;
        if (stored.readiness !== "ready") {
            const flipped = {
                ...stored,
                readiness: "ready",
                blocking: [],
                revision: stored.revision + 1,
            };
            const ok = await this.deps.projects.replace(flipped, stored.revision);
            if (!ok) {
                const again = await this.deps.projects.get(stored.id);
                if (again?.readiness !== "ready") {
                    throw new OnboardingConflictError("revision_conflict", "the project record changed concurrently — retry validation");
                }
                record = again;
            }
            else {
                record = flipped;
            }
        }
        try {
            this.activate(record);
        }
        catch (error) {
            return this.failValidation(current, actor, report, safeMessage(error));
        }
        if (!this.deps.registry.has(record.id)) {
            return this.failValidation(current, actor, report, "project is not in the Project Registry");
        }
        const finalReport = {
            ...report,
            checks: [
                ...report.checks,
                {
                    key: "registry_lookup",
                    title: "Project is discoverable in the Project Registry",
                    mandatory: true,
                    passed: true,
                    detail: "registered",
                },
            ],
        };
        current = await this.save(current, (draft) => {
            this.transition(draft, "ready");
            draft.validation = finalReport;
            draft.failure = undefined;
        });
        this.audit(current, actor, "project_ready", { projectId: current.projectId });
        return current;
    }
    /* -------------------------------------------------------------- */
    /* Registry activation (also used at startup to re-hydrate)       */
    /* -------------------------------------------------------------- */
    /**
     * Registers a READY-eligible provisioned project in the in-process Project
     * Registry (idempotent). Used after validation and by the startup sync.
     */
    activate(project) {
        if (this.deps.registry.has(project.id))
            return;
        const repository = project.repository?.repositoryUrl
            ? parseProjectRepositoryRef({
                url: project.repository.repositoryUrl,
                defaultBranch: project.repository.defaultBranch ?? "main",
            })
            : undefined;
        this.deps.registry.register(this.deps.adapterFactory(project), {
            displayName: project.displayName,
            metadata: {
                onboardingId: project.onboardingId,
                code: project.code,
                provisioned: true,
                ...(repository ? { repository } : {}),
            },
        });
    }
    /* -------------------------------------------------------------- */
    /* steps                                                          */
    /* -------------------------------------------------------------- */
    async execute(session, planned, actor) {
        const plan = session.plan;
        if (!planned.executable) {
            throw new ValidationError(`step ${planned.key} is not executable on this platform`);
        }
        switch (planned.key) {
            case "registry_entry": {
                const record = this.buildRecord(session, actor);
                const result = await this.deps.projects.create(record);
                if (result.result === "created") {
                    return "Project record created (not yet READY; validation pending).";
                }
                if (result.result === "exists" && result.sameOnboarding) {
                    return "Project record already existed for this onboarding (idempotent).";
                }
                if (result.result === "exists") {
                    throw new OnboardingConflictError("duplicate_project", "a project with this id already exists");
                }
                throw new OnboardingConflictError("duplicate_project", result.reason === "code"
                    ? "a project with this code already exists"
                    : "this repository is already bound to another project");
            }
            case "repository_binding": {
                const url = plan.repository.repositoryUrl;
                const ref = url
                    ? parseProjectRepositoryRef({
                        url,
                        defaultBranch: plan.repository.defaultBranch ?? "main",
                    })
                    : undefined;
                if (!ref) {
                    throw new ValidationError("repository reference is invalid or carries credentials");
                }
                return `Repository ${repositoryKey(ref)} bound (credential-free reference; read-only, not authorized for writes).`;
            }
            case "environment_profile":
                return `${plan.environments.length} environment requirement(s) recorded (${plan.environments.filter((e) => e.availability === "qualified_instance_available").length} with a qualified instance).`;
            case "agent_policy":
                return `${plan.workforce.length} workforce entr(ies) recorded; ${plan.workforce.filter((w) => w.qualified).length} qualified.`;
            case "integration_policies":
                return `${plan.integrations.length} integration polic(ies) recorded.`;
            case "secret_requirements":
                return `${plan.secrets.length} required variable name(s) recorded (names only; no value held).`;
            case "git_workflow":
                if (plan.git.allowDirectDefaultBranchWrites) {
                    throw new ValidationError("direct default-branch writes must not be enabled by onboarding");
                }
                return "Conservative Git policy recorded (PRs and review required, no direct default-branch writes).";
            case "build_test_pipeline": {
                const resolved = plan.pipeline.filter((s) => s.status === "resolved").length;
                return `${resolved}/${plan.pipeline.length} pipeline stage(s) resolved from evidence; the rest remain unresolved.`;
            }
            case "deployment_configuration":
                return `${plan.deployment.targets.length} deployment target(s) modelled — nothing deployed.`;
            case "cost_policy":
                return "Budget policy recorded. Enforcement is not implemented and is reported as not enforced.";
            case "audit_baseline": {
                const baseline = this.baseline(session);
                this.deps.audit.record("onboarding_event", {
                    projectId: session.projectId,
                    data: {
                        event: "baseline_established",
                        onboardingId: session.id,
                        actor,
                        baseline,
                    },
                });
                return "Audit baseline established from real data; unknown fields remain Unavailable.";
            }
            case "project_knowledge":
                return `${plan.knowledge.length} documentation reference(s) registered (paths only; no content ingested).`;
            default:
                throw new ValidationError(`unknown step ${planned.key}`);
        }
    }
    buildRecord(session, actor) {
        const plan = session.plan;
        const repositoryUrl = plan.repository.repositoryUrl;
        const ref = repositoryUrl
            ? parseProjectRepositoryRef({
                url: repositoryUrl,
                defaultBranch: plan.repository.defaultBranch ?? "main",
            })
            : undefined;
        return {
            id: session.projectId,
            code: plan.identity.code,
            displayName: plan.identity.name,
            ...(plan.identity.fullName ? { fullName: plan.identity.fullName } : {}),
            ...(plan.identity.description ? { description: plan.identity.description } : {}),
            onboardingId: session.id,
            createdBy: actor,
            createdAt: this.clock(),
            readiness: "blocked",
            ...(repositoryUrl ? { repository: { ...plan.repository } } : {}),
            ...(ref ? { repositoryKey: repositoryKey(ref) } : {}),
            plan,
            baseline: this.baseline(session),
            blocking: ["validation pending"],
            revision: 1,
        };
    }
    /** AI Auditor baseline: every field is a real value or "Unavailable". */
    baseline(session) {
        const plan = session.plan;
        const analysis = session.analysis;
        const deps = analysis?.dependencies;
        return {
            establishedAt: this.clock(),
            repositoryCommit: plan.repository.commit ?? UNAVAILABLE,
            branch: plan.repository.branch ?? UNAVAILABLE,
            architectureRevision: `plan v${plan.planVersion} (${plan.planHash.slice(0, 12)})`,
            dependencySummary: deps && (deps.runtimeCount !== undefined || deps.devCount !== undefined)
                ? `${deps.runtimeCount ?? 0} runtime / ${deps.devCount ?? 0} dev (root manifest)`
                : UNAVAILABLE,
            testStatus: UNAVAILABLE,
            securityFindings: analysis
                ? `${analysis.security.length} static finding(s) at analysis`
                : UNAVAILABLE,
            deploymentState: UNAVAILABLE,
        };
    }
    /* -------------------------------------------------------------- */
    /* validation                                                     */
    /* -------------------------------------------------------------- */
    async check(session) {
        const plan = session.plan;
        const run = session.provisioning;
        const checks = [];
        const add = (key, title, mandatory, passed, detail) => checks.push({ key, title, mandatory, passed, detail });
        const stored = await this.deps.projects.get(session.projectId);
        add("project_record", "Project record persisted for this onboarding", true, stored?.onboardingId === session.id, stored ? "found" : "missing");
        add("plan_bound", "Provisioning is bound to the approved plan", true, session.approval?.planHash === plan.planHash &&
            run?.planHash === plan.planHash, "approval, run and plan hashes match");
        const incomplete = (run?.steps ?? []).filter((step) => step.mandatory && step.status !== "complete");
        add("mandatory_steps", "All mandatory provisioning steps complete", true, incomplete.length === 0, incomplete.length === 0
            ? "complete"
            : `incomplete: ${incomplete.map((s) => s.key).join(", ")}`);
        const isImport = session.kind === "import_existing";
        add("repository_access", "Repository reference bound and readable at analysis", isImport, isImport
            ? Boolean(plan.repository.repositoryUrl && plan.repository.commit)
            : Boolean(plan.repository.repositoryUrl), isImport
            ? plan.repository.commit
                ? `read at commit ${plan.repository.commit.slice(0, 7)}`
                : "no analysed commit"
            : "no repository bound (pending requirement)");
        add("git_policy_safe", "Git policy has no direct default-branch writes", true, !plan.git.allowDirectDefaultBranchWrites, "conservative Git policy");
        add("test_policy", "Test and review policy recorded", true, typeof plan.git.testsRequired === "boolean" &&
            typeof plan.git.reviewRequired === "boolean", "recorded");
        add("build_command_known", "Build command resolved from evidence", false, plan.pipeline.some((step) => step.stage === "build" && step.status === "resolved"), "otherwise left unresolved (never guessed)");
        add("deployment_configured", "Deployment target configured", false, plan.deployment.targets.length > 0, "modelled only; not deployed");
        add("knowledge_registered", "Project knowledge references registered", false, plan.knowledge.length > 0, `${plan.knowledge.length} reference(s)`);
        const blocking = checks
            .filter((check) => check.mandatory && !check.passed)
            .map((check) => `${check.title} (${check.detail})`);
        return {
            checkedAt: this.clock(),
            ready: blocking.length === 0,
            checks,
            blocking,
        };
    }
    async failValidation(session, actor, report, reason) {
        const failed = {
            ...report,
            ready: false,
            blocking: [...report.blocking, reason],
            checks: [
                ...report.checks,
                {
                    key: "registry_lookup",
                    title: "Project is discoverable in the Project Registry",
                    mandatory: true,
                    passed: false,
                    detail: reason,
                },
            ],
        };
        const next = await this.save(session, (draft) => {
            this.transition(draft, "validation_failed");
            draft.validation = failed;
            draft.failure = {
                code: "validation_failed",
                message: `blocked: ${failed.blocking.join("; ")}`,
                at: this.clock(),
            };
        });
        this.audit(next, actor, "validation_failed", { blocking: failed.blocking });
        return next;
    }
    /* -------------------------------------------------------------- */
    /* persistence helpers                                            */
    /* -------------------------------------------------------------- */
    startRun(session, steps) {
        const plan = session.plan;
        const previous = session.provisioning;
        const resumable = previous && previous.planHash === plan.planHash ? previous : undefined;
        const now = this.clock();
        return {
            planVersion: plan.planVersion,
            planHash: plan.planHash,
            attempt: (resumable?.attempt ?? 0) + 1,
            startedAt: resumable?.startedAt ?? now,
            updatedAt: now,
            steps: steps.map((planned) => {
                const prior = resumable?.steps.find((step) => step.key === planned.key);
                if (prior && prior.status === "complete")
                    return prior;
                return {
                    key: planned.key,
                    title: planned.title,
                    mandatory: planned.mandatory,
                    external: planned.external,
                    status: planned.executable ? "pending" : "requirement_pending",
                    ...(planned.executable ? {} : { detail: planned.description }),
                };
            }),
        };
    }
    async patchStep(session, key, patch) {
        return this.save(session, (draft) => {
            const run = draft.provisioning;
            run.steps = run.steps.map((step) => step.key === key ? { ...step, ...patch } : step);
            run.updatedAt = this.clock();
        });
    }
    transition(draft, to) {
        if (draft.status !== to && !canTransitionOnboarding(draft.status, to)) {
            throw new StateTransitionError(`cannot move onboarding from ${draft.status} to ${to}`);
        }
        draft.status = to;
    }
    async save(current, mutate) {
        const draft = structuredClone(current);
        mutate(draft);
        draft.revision = current.revision + 1;
        draft.updatedAt = this.clock();
        const ok = await this.deps.sessions.replace(draft, current.revision);
        if (!ok) {
            throw new OnboardingConflictError("revision_conflict", "the onboarding session changed concurrently — reload the latest state");
        }
        return draft;
    }
    audit(session, actor, event, data) {
        this.deps.audit.record("onboarding_event", {
            projectId: session.projectId,
            data: { event, onboardingId: session.id, actor, ...data },
        });
    }
}
function safeMessage(error) {
    const text = error instanceof Error ? error.message : String(error);
    return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}
