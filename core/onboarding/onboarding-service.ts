/**
 * OnboardingService (PROJECT-2) — the domain service behind the onboarding
 * commands. It owns the deterministic lifecycle, authorization, validation,
 * revision protection and duplicate protection. Execution of an approved plan
 * is delegated to `ProjectProvisioningService`.
 *
 *   AUTHENTICATED != AUTHORIZED   every method requires `create_project`
 *   DISCOVERED != APPROVED        analysis never approves anything
 *   APPROVED != PROVISIONED       provisioning is a separate, tracked run
 *
 * The browser never reaches this class directly: it is called only by the
 * Control Plane command/query services after authentication.
 */
import { randomBytes } from "node:crypto";
import {
  NotFoundError,
  PermissionDeniedError,
  StateTransitionError,
  ValidationError,
  operatorCan,
  type OperatorPrincipal,
} from "../../contracts/index.js";
import type {
  OnboardingCapabilitiesView,
  OnboardingDraft,
  OnboardingIdentity,
  OnboardingKind,
  OnboardingOverride,
  OnboardingSession,
  OnboardingSessionStore,
  OnboardingSessionSummary,
  OnboardingSource,
  OnboardingStatus,
  ProvisionedProjectStore,
  GitPolicy,
  CostPolicy,
  AutonomyLevel,
  ProjectAnalysis,
} from "../../contracts/onboarding.js";
import {
  AUTONOMY_LEVELS,
  EDITABLE_ONBOARDING_STATUSES,
  ONBOARDING_KINDS,
  ONBOARDING_MODES,
  PROJECT_CODE_PATTERN,
  PROJECT_PRIORITIES,
  canTransitionOnboarding,
} from "../../contracts/onboarding.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { ProjectRegistry } from "../registry/project-registry.js";
import {
  parseProjectRepositoryRef,
  repositoryKey,
} from "../registry/project-repository-ref.js";
import { assertNoSecrets } from "../planning/plan-secret-guard.js";
import {
  analyzeRepositoryEvidence,
  analyzeSpecification,
} from "./discovery.js";
import { OnboardingConflictError } from "./onboarding-errors.js";
import { buildPlan, type PlanningContext } from "./planner.js";
import { ProjectProvisioningService, STALE_RUN_MS } from "./provisioning-service.js";
import {
  parseGitHubTarget,
  type RepositorySourceReader,
} from "./repository-source.js";

export interface OnboardingPlatform {
  descriptors: PlanningContext["descriptors"];
  usableDescriptorIds: PlanningContext["usableDescriptorIds"];
  agents: PlanningContext["agents"];
}

export interface OnboardingServiceDeps {
  sessions: OnboardingSessionStore;
  projects: ProvisionedProjectStore;
  registry: ProjectRegistry;
  audit: AuditLog;
  reader: RepositorySourceReader;
  provisioning: ProjectProvisioningService;
  /** Live platform state (environments, agents) — never a snapshot literal. */
  platform: () => OnboardingPlatform;
  clock?: () => string;
  newId?: () => string;
}

export interface OnboardingOutcome {
  session: OnboardingSession;
  /** True when the request repeated work that was already done. */
  idempotent?: boolean;
  note?: string;
}

const OVERRIDE_FIELDS = [
  "language",
  "framework",
  "database",
  "authentication",
  "packageManager",
  "buildSystem",
  "testSystem",
  "deployment",
] as const;

const ANALYSIS_STALE_MS = 2 * 60_000;

export interface OnboardingCreateInput {
  mode?: unknown;
  kind?: unknown;
  identity?: unknown;
  source?: unknown;
}

export interface OnboardingPatchInput {
  identity?: unknown;
  source?: unknown;
  overrides?: unknown;
  autonomyLevel?: unknown;
  gitPolicy?: unknown;
  costPolicy?: unknown;
}

export class OnboardingService {
  private readonly clock: () => string;
  private readonly newId: () => string;

  constructor(private readonly deps: OnboardingServiceDeps) {
    this.clock = deps.clock ?? (() => new Date().toISOString());
    this.newId =
      deps.newId ?? (() => `onb-${randomBytes(6).toString("hex")}`);
  }

  /* -------------------------------------------------------------- */
  /* queries                                                        */
  /* -------------------------------------------------------------- */

  capabilities(principal: OperatorPrincipal): OnboardingCapabilitiesView {
    const canCreate = this.canCreate(principal);
    const github = this.deps.reader.providers.includes("github");
    return {
      canCreate,
      providers: [
        {
          provider: "github",
          available: github,
          note: github
            ? this.deps.reader.privateAccess
              ? "Read-only discovery of public and private repositories through the server-side GitHub credential."
              : "Read-only discovery of PUBLIC repositories. Private repositories need the server-side GitHub credential, which is not configured."
            : "No GitHub reader is configured.",
        },
        { provider: "template", available: true, note: "Start from an idea or requirements." },
        { provider: "local_workspace", available: false, note: "Requires a future Desktop Agent / environment bridge; a browser cannot read local folders." },
        { provider: "gitlab", available: false, note: "No GitLab integration exists." },
        { provider: "bitbucket", available: false, note: "No Bitbucket integration exists." },
        { provider: "azure_devops", available: false, note: "No Azure DevOps integration exists." },
        { provider: "source_bundle", available: false, note: "Uploaded source bundles are not supported yet." },
        { provider: "existing_project", available: false, note: "Cloning an existing AI Workforce project is not supported yet." },
      ],
      kinds: [
        { kind: "create_new", available: true, note: "Propose an architecture from requirements." },
        { kind: "import_existing", available: github, note: github ? "Import a GitHub repository." : "No repository reader is configured." },
        { kind: "import_local", available: false, note: "Requires a future Desktop Agent / environment bridge; a browser cannot safely read a local folder." },
      ],
      gaps: [
        { key: "github_repository_creation", note: "Governed GitHub repository creation is not implemented; it stays a pending requirement." },
        { key: "firebase_provisioning", note: "Automatic Firebase project creation is not implemented; it stays a pending requirement." },
        { key: "cost_enforcement", note: "Budget policies are recorded but not enforced: no AI Cost Center is wired." },
        { key: "agent_assignment", note: "Only registered production agents can be listed; roadmap roles have no implementation yet." },
        { key: "objective_pipeline", note: "Objective-to-software execution is a future layer; onboarding does not run agents." },
      ],
    };
  }

  async list(principal: OperatorPrincipal): Promise<OnboardingSessionSummary[]> {
    this.requireCreator(principal);
    const all = await this.deps.sessions.list();
    return all
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((session) => this.summary(session));
  }

  async get(principal: OperatorPrincipal, id: string): Promise<OnboardingSession> {
    this.requireCreator(principal);
    return this.load(id);
  }

  /* -------------------------------------------------------------- */
  /* commands                                                       */
  /* -------------------------------------------------------------- */

  async create(
    principal: OperatorPrincipal,
    input: OnboardingCreateInput,
  ): Promise<OnboardingOutcome> {
    this.requireCreator(principal);
    const mode = enumValue(input?.mode, ONBOARDING_MODES, "mode");
    const kind = enumValue(input?.kind, ONBOARDING_KINDS, "kind");
    if (kind === "import_local") {
      throw new ValidationError(
        "local import is unavailable: it requires a future Desktop Agent / environment bridge",
      );
    }
    const now = this.clock();
    const draft: OnboardingDraft = {
      identity: {
        name: "",
        code: "",
        priority: "normal",
        owner: principal.id,
      },
      source: { provider: kind === "create_new" ? "template" : "github" },
      overrides: [],
      autonomyLevel: 1,
    };
    const projectId = `proj-${randomBytes(6).toString("hex")}`;
    let session: OnboardingSession = {
      id: this.newId(),
      projectId,
      requestedBy: principal.id,
      mode,
      kind,
      status: "draft",
      draft,
      createdAt: now,
      updatedAt: now,
      revision: 1,
    };
    if (input?.identity !== undefined || input?.source !== undefined) {
      session = this.applyPatch(session, {
        identity: input.identity,
        source: input.source,
      });
      if (this.sourceComplete(session)) session.status = "source_configured";
    }
    assertNoSecrets(session.draft, "draft");
    const created = await this.deps.sessions.create(session);
    if (!created) throw new OnboardingConflictError("duplicate_project", "onboarding id collision — retry");
    this.audit(session, principal, "session_created", { mode, kind });
    return { session };
  }

  async update(
    principal: OperatorPrincipal,
    input: { id?: unknown; expectedRevision?: unknown; patch?: unknown },
  ): Promise<OnboardingOutcome> {
    this.requireCreator(principal);
    const current = await this.loadForWrite(input.id, input.expectedRevision);
    if (![...EDITABLE_ONBOARDING_STATUSES, "approved"].includes(current.status)) {
      throw new StateTransitionError(
        `the draft cannot be edited while onboarding is ${current.status}`,
      );
    }
    if (!isRecord(input.patch)) throw new ValidationError("patch must be an object");
    const patched = this.applyPatch(current, input.patch as OnboardingPatchInput);
    assertNoSecrets(patched.draft, "draft");
    await this.checkDuplicates(patched, false);

    const sourceChanged =
      JSON.stringify(patched.draft.source) !== JSON.stringify(current.draft.source);
    const planWasInvalidated = current.plan !== undefined || current.approval !== undefined;
    const next = structuredClone(patched);
    if (sourceChanged) {
      next.analysis = undefined;
      next.plan = undefined;
      next.approval = undefined;
      next.failure = undefined;
      next.status = this.sourceComplete(next) ? "source_configured" : "draft";
    } else if (planWasInvalidated) {
      // Same evidence, different decision: keep the analysis, force a re-plan
      // and a fresh approval. An approval never survives a changed plan.
      next.plan = undefined;
      next.approval = undefined;
      next.status = "analyzed";
    } else if (current.status === "draft" && this.sourceComplete(next)) {
      next.status = "source_configured";
    }
    if (next.status !== current.status && !canTransitionOnboarding(current.status, next.status)) {
      throw new StateTransitionError(`cannot move onboarding from ${current.status} to ${next.status}`);
    }
    const saved = await this.persist(next, current.revision);
    this.audit(saved, principal, planWasInvalidated ? "plan_changed" : "draft_updated", {
      fields: Object.keys(input.patch as object),
      approvalRevoked: planWasInvalidated,
    });
    return { session: saved };
  }

  async analyze(
    principal: OperatorPrincipal,
    input: { id?: unknown; expectedRevision?: unknown },
  ): Promise<OnboardingOutcome> {
    this.requireCreator(principal);
    const current = await this.loadForWrite(input.id, input.expectedRevision);
    const stale =
      current.status === "analyzing" &&
      Date.now() - Date.parse(current.updatedAt) > ANALYSIS_STALE_MS;
    if (
      !["source_configured", "analyzed", "analysis_failed"].includes(current.status) &&
      !stale
    ) {
      throw new StateTransitionError(`cannot analyze while onboarding is ${current.status}`);
    }
    if (!this.sourceComplete(current)) {
      throw new ValidationError("configure the source before analysis");
    }
    const analyzing = await this.persist(
      { ...structuredClone(current), status: "analyzing", failure: undefined },
      current.revision,
    );
    this.audit(analyzing, principal, "analysis_started", { kind: current.kind });

    let analysis: ProjectAnalysis | undefined;
    let failure: { code: string; message: string } | undefined;
    if (current.kind === "import_existing") {
      const source = current.draft.source;
      const result = await this.deps.reader.read({
        provider: source.provider,
        url: source.repositoryUrl!,
        ...(source.branch ? { branch: source.branch } : {}),
      });
      if (result.ok) {
        analysis = analyzeRepositoryEvidence(result.evidence, this.clock());
      } else {
        failure = { code: result.code, message: result.message };
      }
    } else {
      analysis = analyzeSpecification(
        current.draft.source.specification ?? "",
        this.clock(),
      );
    }

    const done = structuredClone(analyzing);
    done.plan = undefined;
    done.approval = undefined;
    if (analysis) {
      done.analysis = analysis;
      done.status = "analyzed";
      done.failure = undefined;
    } else {
      done.analysis = undefined;
      done.status = "analysis_failed";
      done.failure = { ...failure!, at: this.clock() };
    }
    const saved = await this.persist(done, analyzing.revision);
    this.audit(saved, principal, analysis ? "analysis_completed" : "analysis_failed", {
      reason: failure?.code,
    });
    return { session: saved };
  }

  async plan(
    principal: OperatorPrincipal,
    input: { id?: unknown; expectedRevision?: unknown },
  ): Promise<OnboardingOutcome> {
    this.requireCreator(principal);
    const current = await this.loadForWrite(input.id, input.expectedRevision);
    if (!["analyzed", "review_required"].includes(current.status)) {
      throw new StateTransitionError(`cannot plan while onboarding is ${current.status}`);
    }
    if (!current.analysis) throw new StateTransitionError("analysis is required before planning");
    this.requireIdentity(current.draft.identity);
    await this.checkDuplicates(current, true);
    const platform = this.deps.platform();
    const version = (current.planVersionCounter ?? current.plan?.planVersion ?? 0) + 1;
    const plan = buildPlan(current, current.analysis, version, {
      now: this.clock(),
      descriptors: platform.descriptors,
      usableDescriptorIds: platform.usableDescriptorIds,
      agents: platform.agents,
      githubPrivateAccess: this.deps.reader.privateAccess,
      githubRepositoryCreation: false,
      firebaseProvisioning: false,
    });
    assertNoSecrets(plan, "plan");
    const next = structuredClone(current);
    next.plan = plan;
    next.planVersionCounter = version;
    next.approval = undefined;
    next.status = "review_required";
    const saved = await this.persist(next, current.revision);
    this.audit(saved, principal, "plan_generated", {
      planVersion: version,
      blockers: plan.blockers.length,
      warnings: plan.warnings.length,
    });
    return { session: saved };
  }

  async approvePlan(
    principal: OperatorPrincipal,
    input: {
      id?: unknown;
      expectedRevision?: unknown;
      planVersion?: unknown;
      planHash?: unknown;
    },
  ): Promise<OnboardingOutcome> {
    this.requireCreator(principal);
    const current = await this.loadForWrite(input.id, input.expectedRevision);
    if (current.status !== "review_required" || !current.plan) {
      throw new StateTransitionError(`no plan is awaiting approval (status: ${current.status})`);
    }
    if (input.planVersion !== current.plan.planVersion || input.planHash !== current.plan.planHash) {
      throw new StateTransitionError("the plan changed — review the current version before approving");
    }
    if (current.plan.blockers.length > 0) {
      throw new ValidationError(
        `the plan has blockers: ${current.plan.blockers.map((b) => b.message).join("; ")}`,
      );
    }
    await this.checkDuplicates(current, true);
    const next = structuredClone(current);
    next.status = "approved";
    next.approval = {
      planVersion: current.plan.planVersion,
      planHash: current.plan.planHash,
      approvedBy: principal.id,
      approvedAt: this.clock(),
    };
    const saved = await this.persist(next, current.revision);
    this.audit(saved, principal, "plan_approved", { planVersion: current.plan.planVersion });
    return { session: saved };
  }

  async provision(
    principal: OperatorPrincipal,
    input: { id?: unknown; expectedRevision?: unknown; planHash?: unknown },
  ): Promise<OnboardingOutcome> {
    this.requireCreator(principal);
    const id = requireString(input.id, "id");
    const current = await this.load(id);
    if (typeof input.planHash !== "string") throw new ValidationError("planHash is required");

    // Idempotency: a repeat of an in-flight or finished provisioning request
    // for the SAME approved plan returns the current state, never a second run.
    if (
      ["provisioning", "validating", "ready"].includes(current.status) &&
      current.approval?.planHash === input.planHash
    ) {
      const staleRun =
        current.status !== "ready" &&
        Date.now() - Date.parse(current.updatedAt) > STALE_RUN_MS;
      if (!staleRun) {
        return { session: current, idempotent: true, note: "provisioning already requested for this plan" };
      }
    }
    if (input.expectedRevision !== undefined && input.expectedRevision !== current.revision) {
      throw new OnboardingConflictError(
        "revision_conflict",
        "the onboarding session changed — reload the latest state",
        current.revision,
      );
    }
    const resumable: OnboardingStatus[] = ["approved", "provisioning_failed", "validation_failed", "provisioning", "validating"];
    if (!resumable.includes(current.status)) {
      throw new StateTransitionError(`cannot provision while onboarding is ${current.status}`);
    }
    if (!current.plan || !current.approval || current.approval.planHash !== input.planHash || current.plan.planHash !== input.planHash) {
      throw new StateTransitionError("the approved plan does not match this request — approve the current plan first");
    }
    // A `provisioning`/`validating` row that reached this point is stale (a
    // live one returned above): route it through the explicit failure edge so
    // the state machine stays honest, then resume from recorded progress.
    let base = current;
    if (current.status === "provisioning" || current.status === "validating") {
      const failed = structuredClone(current);
      failed.status = current.status === "provisioning" ? "provisioning_failed" : "validation_failed";
      failed.failure = { code: "stale_run", message: "the previous run stopped without finishing; resuming", at: this.clock() };
      base = await this.persist(failed, current.revision);
    }
    const session = await this.deps.provisioning.run(base, principal.id);
    return { session };
  }

  async revalidate(
    principal: OperatorPrincipal,
    input: { id?: unknown; expectedRevision?: unknown },
  ): Promise<OnboardingOutcome> {
    this.requireCreator(principal);
    const current = await this.loadForWrite(input.id, input.expectedRevision);
    if (current.status !== "validation_failed") {
      throw new StateTransitionError(`nothing to re-validate (status: ${current.status})`);
    }
    const session = await this.deps.provisioning.validate(current, principal.id);
    return { session };
  }

  async cancel(
    principal: OperatorPrincipal,
    input: { id?: unknown; expectedRevision?: unknown; reason?: unknown },
  ): Promise<OnboardingOutcome> {
    this.requireCreator(principal);
    const current = await this.loadForWrite(input.id, input.expectedRevision);
    if (current.status === "cancelled") {
      return { session: current, idempotent: true };
    }
    if (!canTransitionOnboarding(current.status, "cancelled")) {
      throw new StateTransitionError(
        current.status === "ready"
          ? "a READY project cannot be cancelled through onboarding"
          : `onboarding cannot be cancelled while it is ${current.status}`,
      );
    }
    const reason = optionalText(input.reason, "reason", 300);
    const next = structuredClone(current);
    next.status = "cancelled";
    next.failure = undefined;
    const saved = await this.persist(next, current.revision);
    const sideEffects =
      current.provisioning?.steps.some((s) => s.status === "complete") ?? false;
    this.audit(saved, principal, "onboarding_cancelled", {
      reason,
      externalSideEffectsRemain: sideEffects,
    });
    return {
      session: saved,
      note: sideEffects
        ? "Cancelled. Steps that already completed were NOT undone; any created project record remains blocked."
        : "Cancelled. Nothing had been provisioned.",
    };
  }

  /* -------------------------------------------------------------- */
  /* validation + draft mutation                                    */
  /* -------------------------------------------------------------- */

  private applyPatch(
    session: OnboardingSession,
    patch: OnboardingPatchInput,
  ): OnboardingSession {
    const next = structuredClone(session);
    const draft = next.draft;
    if (patch.identity !== undefined) {
      draft.identity = validateIdentity(patch.identity, draft.identity);
    }
    if (patch.source !== undefined) {
      draft.source = validateSource(patch.source, draft.source, session.kind);
    }
    if (patch.overrides !== undefined) draft.overrides = validateOverrides(patch.overrides);
    if (patch.autonomyLevel !== undefined) {
      if (!AUTONOMY_LEVELS.includes(patch.autonomyLevel as AutonomyLevel)) {
        throw new ValidationError("autonomyLevel must be 1–5");
      }
      draft.autonomyLevel = patch.autonomyLevel as AutonomyLevel;
    }
    if (patch.gitPolicy !== undefined) {
      draft.gitPolicy = validateGitPolicy(patch.gitPolicy, draft.autonomyLevel);
    }
    if (patch.costPolicy !== undefined) draft.costPolicy = validateCostPolicy(patch.costPolicy);
    // The git policy's auto-push rule depends on the level: re-check.
    if (draft.gitPolicy?.autoPush && draft.autonomyLevel < 3) {
      throw new ValidationError("autoPush requires autonomy level 3 or higher");
    }
    return next;
  }

  private sourceComplete(session: OnboardingSession): boolean {
    const source = session.draft.source;
    return session.kind === "import_existing"
      ? typeof source.repositoryUrl === "string" && source.repositoryUrl !== ""
      : typeof source.specification === "string" &&
          source.specification.trim().length >= 20;
  }

  private requireIdentity(identity: OnboardingIdentity): void {
    if (identity.name.trim() === "") throw new ValidationError("project name is required");
    if (!PROJECT_CODE_PATTERN.test(identity.code)) {
      throw new ValidationError("project code is required (2–12 characters, upper-case letters and digits, starting with a letter)");
    }
  }

  /**
   * Duplicate protection: project id (immutable, server-made), code and
   * repository binding must be unique across projects and — at plan/approval
   * time — across other live onboarding sessions.
   */
  private async checkDuplicates(
    session: OnboardingSession,
    strict: boolean,
  ): Promise<void> {
    const code = session.draft.identity.code;
    const url = session.draft.source.repositoryUrl;
    const target = url ? parseGitHubTarget(url) : undefined;
    const key = target
      ? repositoryKey({ url: `https://github.com/${target.owner}/${target.name}`, defaultBranch: "main" })
      : undefined;
    if (this.deps.registry.has(session.projectId)) {
      throw new OnboardingConflictError("duplicate_project", "project id already exists");
    }
    for (const project of await this.deps.projects.list()) {
      if (project.onboardingId === session.id) continue;
      if (code !== "" && project.code === code) {
        throw new OnboardingConflictError("duplicate_project", `project code ${code} is already used by another project`);
      }
      if (key !== undefined && project.repositoryKey === key) {
        throw new OnboardingConflictError("duplicate_project", "this repository is already bound to another project");
      }
    }
    for (const registration of this.deps.registry.list()) {
      const repo = registration.metadata["repository"];
      const parsed = repo ? parseProjectRepositoryRef(repo) : undefined;
      if (key !== undefined && parsed && repositoryKey(parsed) === key) {
        throw new OnboardingConflictError("duplicate_project", `this repository is already bound to project ${registration.projectId}`);
      }
    }
    if (strict) {
      for (const other of await this.deps.sessions.list()) {
        if (other.id === session.id || ["cancelled", "analysis_failed"].includes(other.status)) continue;
        if (code !== "" && other.draft.identity.code === code && other.status !== "draft") {
          throw new OnboardingConflictError("duplicate_project", `project code ${code} is already used by another onboarding in progress`);
        }
      }
    }
  }

  /* -------------------------------------------------------------- */
  /* persistence + helpers                                          */
  /* -------------------------------------------------------------- */

  private async load(id: string): Promise<OnboardingSession> {
    const session = await this.deps.sessions.get(requireString(id, "id"));
    if (!session) throw new NotFoundError("onboarding session not found");
    return session;
  }

  private async loadForWrite(
    id: unknown,
    expectedRevision: unknown,
  ): Promise<OnboardingSession> {
    const session = await this.load(requireString(id, "id"));
    if (typeof expectedRevision !== "number" || !Number.isInteger(expectedRevision)) {
      throw new ValidationError("expectedRevision is required");
    }
    if (expectedRevision !== session.revision) {
      throw new OnboardingConflictError(
        "revision_conflict",
        "the onboarding session changed — reload the latest state",
        session.revision,
      );
    }
    return session;
  }

  private async persist(
    next: OnboardingSession,
    expectedRevision: number,
  ): Promise<OnboardingSession> {
    const saved = { ...next, revision: expectedRevision + 1, updatedAt: this.clock() };
    if (!(await this.deps.sessions.replace(saved, expectedRevision))) {
      throw new OnboardingConflictError(
        "revision_conflict",
        "the onboarding session changed concurrently — reload the latest state",
      );
    }
    return saved;
  }

  private canCreate(principal: OperatorPrincipal): boolean {
    // A scoped operator could never see the project it creates.
    return operatorCan(principal, "create_project") && principal.allowedProjects === "*";
  }

  private requireCreator(principal: OperatorPrincipal): void {
    if (!operatorCan(principal, "create_project")) {
      throw new PermissionDeniedError(`role "${principal.role}" may not create or provision projects`);
    }
    if (principal.allowedProjects !== "*") {
      throw new PermissionDeniedError("project-scoped operators may not create projects");
    }
  }

  private summary(session: OnboardingSession): OnboardingSessionSummary {
    return {
      id: session.id,
      projectId: session.projectId,
      name: session.draft.identity.name,
      code: session.draft.identity.code,
      mode: session.mode,
      kind: session.kind,
      status: session.status,
      requestedBy: session.requestedBy,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      revision: session.revision,
    };
  }

  private audit(
    session: OnboardingSession,
    principal: OperatorPrincipal,
    event: string,
    data: Record<string, unknown>,
  ): void {
    this.deps.audit.record("onboarding_event", {
      projectId: session.projectId,
      data: {
        event,
        onboardingId: session.id,
        actor: principal.id,
        status: session.status,
        ...data,
      },
    });
  }
}

/* ------------------------------------------------------------------ */
/* Input validation (untrusted → typed)                               */
/* ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new ValidationError(`${field} must be one of ${allowed.join(", ")}`);
  }
  return value as T;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > 128) {
    throw new ValidationError(`${field} is required`);
  }
  return value;
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function optionalText(value: unknown, field: string, max: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new ValidationError(`${field} must be a string`);
  if (value.length > max) throw new ValidationError(`${field} must be at most ${max} characters`);
  if (CONTROL.test(value)) throw new ValidationError(`${field} contains control characters`);
  return value.trim();
}

function validateIdentity(input: unknown, base: OnboardingIdentity): OnboardingIdentity {
  if (!isRecord(input)) throw new ValidationError("identity must be an object");
  const next: OnboardingIdentity = { ...base };
  if (input["name"] !== undefined) {
    const name = optionalText(input["name"], "identity.name", 80);
    next.name = name ?? "";
  }
  if (input["fullName"] !== undefined) {
    const fullName = optionalText(input["fullName"], "identity.fullName", 160);
    if (fullName === undefined) delete next.fullName;
    else next.fullName = fullName;
  }
  if (input["code"] !== undefined) {
    const code = typeof input["code"] === "string" ? input["code"].trim().toUpperCase() : "";
    if (code !== "" && !PROJECT_CODE_PATTERN.test(code)) {
      throw new ValidationError("identity.code must be 2–12 upper-case letters/digits, starting with a letter");
    }
    next.code = code;
  }
  for (const field of ["description", "objective"] as const) {
    if (input[field] !== undefined) {
      const text = optionalText(input[field], `identity.${field}`, field === "objective" ? 2000 : 1000);
      if (text === undefined) delete next[field];
      else next[field] = text;
    }
  }
  if (input["applicationType"] !== undefined) {
    const text = optionalText(input["applicationType"], "identity.applicationType", 80);
    if (text === undefined) delete next.applicationType;
    else next.applicationType = text;
  }
  if (input["priority"] !== undefined) {
    next.priority = enumValue(input["priority"], PROJECT_PRIORITIES, "identity.priority");
  }
  if (input["owner"] !== undefined) {
    next.owner = requireString(input["owner"], "identity.owner");
  }
  return next;
}

function validateSource(
  input: unknown,
  base: OnboardingSource,
  kind: OnboardingKind,
): OnboardingSource {
  if (!isRecord(input)) throw new ValidationError("source must be an object");
  const next: OnboardingSource = { ...base };
  if (input["provider"] !== undefined && input["provider"] !== base.provider) {
    throw new ValidationError("the source provider cannot be changed after creation");
  }
  if (kind === "import_existing") {
    if (input["repositoryUrl"] !== undefined) {
      const url = input["repositoryUrl"];
      if (typeof url !== "string") throw new ValidationError("source.repositoryUrl must be a string");
      const target = parseGitHubTarget(url.trim());
      if (!target) {
        throw new ValidationError(
          "source.repositoryUrl must be a credential-free https://github.com/<owner>/<name> URL (no token, query or fragment)",
        );
      }
      next.repositoryUrl = `https://github.com/${target.owner}/${target.name}`;
    }
    if (input["branch"] !== undefined) {
      const branch = optionalText(input["branch"], "source.branch", 100);
      if (branch !== undefined && (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/.test(branch) || branch.includes(".."))) {
        throw new ValidationError("source.branch is not a valid branch name");
      }
      if (branch === undefined) delete next.branch;
      else next.branch = branch;
    }
    if (input["specification"] !== undefined || input["createRepository"] !== undefined) {
      throw new ValidationError("specification and createRepository apply to new projects only");
    }
  } else {
    if (input["repositoryUrl"] !== undefined || input["branch"] !== undefined) {
      throw new ValidationError("a new project cannot bind a repository during onboarding");
    }
    if (input["specification"] !== undefined) {
      const spec = optionalText(input["specification"], "source.specification", 20_000);
      if (spec === undefined) delete next.specification;
      else next.specification = spec;
    }
    if (input["createRepository"] !== undefined) {
      if (typeof input["createRepository"] !== "boolean") {
        throw new ValidationError("source.createRepository must be a boolean");
      }
      next.createRepository = input["createRepository"];
    }
  }
  return next;
}

function validateOverrides(input: unknown): OnboardingOverride[] {
  if (!Array.isArray(input) || input.length > 20) {
    throw new ValidationError("overrides must be an array of at most 20 entries");
  }
  return input.map((entry, index) => {
    if (!isRecord(entry)) throw new ValidationError(`overrides[${index}] must be an object`);
    const field = enumValue(entry["field"], OVERRIDE_FIELDS, `overrides[${index}].field`);
    const value = optionalText(entry["value"], `overrides[${index}].value`, 100);
    if (value === undefined) throw new ValidationError(`overrides[${index}].value is required`);
    const recommended = optionalText(entry["recommended"], `overrides[${index}].recommended`, 100);
    const reason = optionalText(entry["reason"], `overrides[${index}].reason`, 300);
    return {
      field,
      value,
      ...(recommended ? { recommended } : {}),
      ...(reason ? { reason } : {}),
    };
  });
}

const GIT_BOOLEANS = [
  "testsRequired",
  "reviewRequired",
  "securityCheckRequired",
  "autoCommit",
  "autoPush",
  "pullRequestRequired",
  "allowDirectDefaultBranchWrites",
] as const;

function validateGitPolicy(input: unknown, level: AutonomyLevel): Partial<GitPolicy> {
  if (!isRecord(input)) throw new ValidationError("gitPolicy must be an object");
  const out: Partial<GitPolicy> = {};
  for (const key of GIT_BOOLEANS) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== "boolean") throw new ValidationError(`gitPolicy.${key} must be a boolean`);
    out[key] = input[key] as boolean;
  }
  // An override may never weaken a security/policy requirement.
  if (out.allowDirectDefaultBranchWrites === true) {
    throw new ValidationError("direct default-branch writes cannot be enabled during onboarding");
  }
  if (out.reviewRequired === false) throw new ValidationError("independent review cannot be disabled during onboarding");
  if (out.securityCheckRequired === false) throw new ValidationError("the security check cannot be disabled during onboarding");
  if (out.autoPush === true && level < 3) throw new ValidationError("autoPush requires autonomy level 3 or higher");
  for (const key of ["defaultBranch", "developmentBranch"] as const) {
    if (input[key] === undefined) continue;
    const branch = optionalText(input[key], `gitPolicy.${key}`, 100);
    if (branch !== undefined) {
      if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/.test(branch) || branch.includes("..")) {
        throw new ValidationError(`gitPolicy.${key} is not a valid branch name`);
      }
      out[key] = branch;
    }
  }
  if (input["agentBranchPattern"] !== undefined) {
    const pattern = optionalText(input["agentBranchPattern"], "gitPolicy.agentBranchPattern", 100);
    if (pattern !== undefined) {
      if (!/^[A-Za-z0-9._/<>-]{1,100}$/.test(pattern) || pattern.includes("..")) {
        throw new ValidationError("gitPolicy.agentBranchPattern is not valid");
      }
      out.agentBranchPattern = pattern;
    }
  }
  if (input["mergePolicy"] !== undefined) {
    out.mergePolicy = enumValue(input["mergePolicy"], ["manual", "approved_only"] as const, "gitPolicy.mergePolicy");
  }
  return out;
}

function validateCostPolicy(input: unknown): Partial<CostPolicy> {
  if (!isRecord(input)) throw new ValidationError("costPolicy must be an object");
  const out: Partial<CostPolicy> = {};
  for (const key of ["dailyLimit", "monthlyLimit", "taskLimit"] as const) {
    const value = input[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 10_000_000) {
      throw new ValidationError(`costPolicy.${key} must be a non-negative number`);
    }
    out[key] = value;
  }
  if (input["warningThresholdPercent"] !== undefined) {
    const value = input["warningThresholdPercent"];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 1 || value > 100) {
      throw new ValidationError("costPolicy.warningThresholdPercent must be 1–100");
    }
    out.warningThresholdPercent = value;
  }
  if (input["hardStop"] !== undefined) {
    if (typeof input["hardStop"] !== "boolean") throw new ValidationError("costPolicy.hardStop must be a boolean");
    out.hardStop = input["hardStop"];
  }
  return out;
}
