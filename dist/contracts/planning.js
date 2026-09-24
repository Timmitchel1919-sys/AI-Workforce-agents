/**
 * Execution Planning contracts — EO-3.1.
 *
 * An `ExecutionPlan` is the authoritative description of INTENDED execution:
 * what is built, which technologies/environments/agents/models it requires,
 * which registered environments and qualified agents satisfy that, how it would
 * be built, tested, secured and deployed, which approvals it needs, and what
 * currently blocks it.
 *
 * EO-3.1 PLANS WORK. IT DOES NOT EXECUTE WORK. Nothing in this file describes a
 * command, a shell, a credential value or an execution result. Every stage
 * carries the literal status `"planned"`; pass/fail results are not
 * representable here.
 *
 * Separation kept explicit: AGENT (responsible worker) ≠ MODEL (intelligence
 * the agent uses) ≠ ENVIRONMENT (execution location/toolchain) ≠ TOOL (bounded
 * capability). Each has its own requirement type and resolver.
 */
import { ENVIRONMENTS, requireArray, requireText, ValidationError, } from "./index.js";
/* ------------------------------------------------------------------ */
/* Project request                                                    */
/* ------------------------------------------------------------------ */
export const COMPONENT_KINDS = [
    "web_frontend",
    "backend_service",
    "mobile_app",
    "desktop_app",
    "game",
    "3d_application",
    "library",
];
export const TARGET_PLATFORMS = [
    "web",
    "ios",
    "android",
    "windows",
    "macos",
    "linux",
];
export const DEPLOYMENT_TARGET_TYPES = [
    "firebase_hosting",
    "cloud_run",
    "app_store",
    "play_store",
    "container_registry",
    "desktop_installer",
];
/* ------------------------------------------------------------------ */
/* Agents and models                                                  */
/* ------------------------------------------------------------------ */
export const AGENT_REQUIREMENT_PURPOSES = [
    "build",
    "test",
    "security_review",
];
export const AGENT_REJECTION_REASONS = [
    "agent_disabled",
    "project_not_allowed",
    "missing_capability",
];
export const MODEL_CAPABILITIES = [
    "reasoning",
    "coding",
    "vision",
    "structured_output",
    "large_context",
];
export const TEST_TYPES = [
    "unit",
    "integration",
    "ui",
    "e2e",
    "build_verification",
    "security",
    "platform_specific",
];
export const SECURITY_CHECKS = [
    "sast",
    "dependency_scan",
    "secret_scan",
    "permission_review",
    "security_agent_review",
];
/* ------------------------------------------------------------------ */
/* Approvals and blockers                                             */
/* ------------------------------------------------------------------ */
export const PLAN_APPROVAL_REASONS = [
    "production_deployment",
    "destructive_migration",
    "privileged_infrastructure",
];
export const BLOCKER_CODES = [
    "MISSING_ENVIRONMENT",
    "MISSING_CAPABILITY",
    "MISSING_TOOLCHAIN",
    "UNSUPPORTED_TECHNOLOGY",
    "NO_QUALIFIED_AGENT",
    "DEPENDENCY_CONFLICT",
    "MISSING_MODEL_CAPABILITY",
    "APPROVAL_REJECTED",
];
/* ------------------------------------------------------------------ */
/* Plan                                                               */
/* ------------------------------------------------------------------ */
export const PLAN_STATUSES = [
    "draft",
    "blocked",
    "ready",
    "awaiting_approval",
    "approved",
    "superseded",
];
export const EXECUTION_PLAN_SCHEMA_VERSION = 1;
/** Allowed lifecycle transitions. Anything else is a `StateTransitionError`. */
export const PLAN_TRANSITIONS = {
    draft: ["blocked", "ready"],
    blocked: ["superseded"],
    ready: ["awaiting_approval", "superseded"],
    awaiting_approval: ["approved", "blocked", "superseded"],
    approved: ["superseded"],
    superseded: [],
};
export function canTransitionPlan(from, to) {
    return PLAN_TRANSITIONS[from].includes(to);
}
/* ------------------------------------------------------------------ */
/* Validation / normalization                                         */
/* ------------------------------------------------------------------ */
const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const SECRET_MANAGER_REF = /^projects\/[a-z0-9-]{1,64}\/secrets\/[A-Za-z0-9_-]{1,255}(\/versions\/(latest|\d{1,6}))?$/;
const PLAIN_REF = /^[a-z0-9][a-z0-9_.-]{0,63}$/;
const MAX_COMPONENTS = 20;
const MAX_TECHNOLOGIES = 10;
const MAX_TEXT = 2000;
export function validateCredentialReference(ref, field = "credentialRef") {
    if (!ref || typeof ref !== "object") {
        throw new ValidationError(`${field} must be an object`);
    }
    const value = requireText(ref.ref, `${field}.ref`);
    if (ref.kind === "secret_manager") {
        if (!SECRET_MANAGER_REF.test(value)) {
            throw new ValidationError(`${field}.ref must be a Secret Manager resource name`);
        }
    }
    else if (ref.kind === "credential_id" || ref.kind === "alias") {
        if (!PLAIN_REF.test(value)) {
            throw new ValidationError(`${field}.ref must be a short lowercase identifier`);
        }
    }
    else {
        throw new ValidationError(`${field}.kind must be secret_manager, credential_id or alias`);
    }
    return { kind: ref.kind, ref: value };
}
function oneOf(value, allowed, field) {
    if (typeof value !== "string" || !allowed.includes(value)) {
        throw new ValidationError(`${field} must be one of ${allowed.join(", ")}`);
    }
    return value;
}
function stableId(value, field) {
    const id = requireText(value, field);
    if (!ID_PATTERN.test(id)) {
        throw new ValidationError(`${field} must be lowercase letters, digits, "-" or "_" (max 64)`);
    }
    return id;
}
function boundedText(value, field) {
    const text = requireText(value, field);
    if (text.length > MAX_TEXT) {
        throw new ValidationError(`${field} must be at most ${MAX_TEXT} chars`);
    }
    return text;
}
/**
 * Validate an untrusted planning request and return a normalized copy that
 * contains ONLY the known request fields. Anything a client might try to
 * smuggle in — a status, an agent id, an environment id, an approval state —
 * is dropped, because those are always derived server-side.
 */
export function normalizeProjectRequest(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new ValidationError("planning request must be an object");
    }
    const raw = input;
    const projectId = requireText(raw.projectId, "request.projectId");
    const title = boundedText(raw.title, "request.title");
    const summary = raw.summary === undefined
        ? undefined
        : boundedText(raw.summary, "request.summary");
    const componentsRaw = requireArray(raw.components, "request.components");
    if (componentsRaw.length === 0 || componentsRaw.length > MAX_COMPONENTS) {
        throw new ValidationError(`request.components must contain 1–${MAX_COMPONENTS} components`);
    }
    const seen = new Set();
    const components = componentsRaw.map((entry, index) => {
        const field = `request.components[${index}]`;
        if (!entry || typeof entry !== "object") {
            throw new ValidationError(`${field} must be an object`);
        }
        const c = entry;
        const id = stableId(c.id, `${field}.id`);
        if (seen.has(id)) {
            throw new ValidationError(`${field}.id "${id}" is duplicated`);
        }
        seen.add(id);
        const platforms = requireArray(c.platforms, `${field}.platforms`).map((p, i) => oneOf(p, TARGET_PLATFORMS, `${field}.platforms[${i}]`));
        if (platforms.length === 0) {
            throw new ValidationError(`${field}.platforms must not be empty`);
        }
        const technologies = requireArray(c.technologies, `${field}.technologies`).map((t, i) => stableId(t, `${field}.technologies[${i}]`));
        if (technologies.length === 0 || technologies.length > MAX_TECHNOLOGIES) {
            throw new ValidationError(`${field}.technologies must contain 1–${MAX_TECHNOLOGIES} entries`);
        }
        const component = {
            id,
            kind: oneOf(c.kind, COMPONENT_KINDS, `${field}.kind`),
            platforms: [...new Set(platforms)],
            technologies: [...new Set(technologies)],
        };
        return component;
    });
    let deployments;
    if (raw.deployments !== undefined) {
        deployments = requireArray(raw.deployments, "request.deployments").map((entry, index) => {
            const field = `request.deployments[${index}]`;
            if (!entry || typeof entry !== "object") {
                throw new ValidationError(`${field} must be an object`);
            }
            const d = entry;
            const componentId = stableId(d.componentId, `${field}.componentId`);
            if (!seen.has(componentId)) {
                throw new ValidationError(`${field}.componentId references an unknown component`);
            }
            const intent = {
                componentId,
                targetType: oneOf(d.targetType, DEPLOYMENT_TARGET_TYPES, `${field}.targetType`),
                stage: oneOf(d.stage, ENVIRONMENTS, `${field}.stage`),
            };
            if (d.credentialRef !== undefined) {
                intent.credentialRef = validateCredentialReference(d.credentialRef, `${field}.credentialRef`);
            }
            return intent;
        });
    }
    let constraints;
    if (raw.constraints !== undefined) {
        if (!raw.constraints || typeof raw.constraints !== "object") {
            throw new ValidationError("request.constraints must be an object");
        }
        const c = raw.constraints;
        constraints = {};
        for (const key of [
            "destructiveMigration",
            "privilegedInfrastructure",
        ]) {
            if (c[key] !== undefined) {
                if (typeof c[key] !== "boolean") {
                    throw new ValidationError(`request.constraints.${key} must be boolean`);
                }
                constraints[key] = c[key];
            }
        }
    }
    return {
        projectId,
        title,
        ...(summary !== undefined ? { summary } : {}),
        components,
        ...(deployments !== undefined ? { deployments } : {}),
        ...(constraints !== undefined ? { constraints } : {}),
    };
}
export function validateModelCapabilityProfile(profile) {
    requireText(profile.id, "modelProfile.id");
    requireText(profile.providerId, "modelProfile.providerId");
    requireArray(profile.capabilities, "modelProfile.capabilities").forEach((c, i) => oneOf(c, MODEL_CAPABILITIES, `modelProfile.capabilities[${i}]`));
}
/** Structural check of a stored/produced plan. Never invents missing fields. */
export function validateExecutionPlan(plan) {
    if (!plan || typeof plan !== "object") {
        throw new ValidationError("execution plan must be an object");
    }
    requireText(plan.id, "plan.id");
    requireText(plan.planId, "plan.planId");
    requireText(plan.projectId, "plan.projectId");
    if (!Number.isInteger(plan.version) || plan.version < 1) {
        throw new ValidationError("plan.version must be a positive integer");
    }
    if (plan.id !== `${plan.planId}@v${plan.version}`) {
        throw new ValidationError("plan.id must equal `${planId}@v${version}`");
    }
    oneOf(plan.status, PLAN_STATUSES, "plan.status");
    if (plan.schemaVersion !== EXECUTION_PLAN_SCHEMA_VERSION) {
        throw new ValidationError("plan.schemaVersion is not supported");
    }
    normalizeProjectRequest(plan.request);
    if (plan.request.projectId !== plan.projectId) {
        throw new ValidationError("plan.request.projectId must match the plan");
    }
    for (const key of [
        "environments",
        "agentRequirements",
        "agents",
        "models",
        "build",
        "tests",
        "security",
        "deployment",
        "approvalRequirements",
        "blockers",
    ]) {
        requireArray(plan[key], `plan.${key}`);
    }
    for (const stage of [
        ...plan.build,
        ...plan.tests,
        ...plan.security,
        ...plan.deployment,
    ]) {
        if (stage.status !== "planned") {
            throw new ValidationError("plan stages may only be `planned`");
        }
    }
    plan.blockers.forEach((b, i) => oneOf(b.code, BLOCKER_CODES, `plan.blockers[${i}].code`));
    if (!plan.dependencies || typeof plan.dependencies !== "object") {
        throw new ValidationError("plan.dependencies must be an object");
    }
    requireArray(plan.dependencies.items, "plan.dependencies.items");
    requireArray(plan.dependencies.order, "plan.dependencies.order");
    requireArray(plan.dependencies.conflicts, "plan.dependencies.conflicts");
    if (plan.status === "blocked" && plan.blockers.length === 0) {
        throw new ValidationError("a blocked plan must carry at least one blocker");
    }
    if ((plan.status === "ready" ||
        plan.status === "awaiting_approval" ||
        plan.status === "approved") &&
        plan.blockers.length > 0) {
        throw new ValidationError(`a ${plan.status} plan must not have blockers`);
    }
    plan.deployment.forEach((d, i) => {
        if (d.credentialRef) {
            validateCredentialReference(d.credentialRef, `plan.deployment[${i}].credentialRef`);
        }
    });
    requireText(plan.inputsFingerprint, "plan.inputsFingerprint");
    requireText(plan.createdBy, "plan.createdBy");
    requireText(plan.createdAt, "plan.createdAt");
    if (plan.cost?.status !== "not_estimated") {
        throw new ValidationError("plan.cost must be `not_estimated`");
    }
}
