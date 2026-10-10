/**
 * Specialist agent domain model.
 *
 * This module is the single authoritative definition of *what an agent is*.
 * It deliberately separates four things the rest of the system keeps apart:
 *
 *   AgentDescriptor  — static identity, capability and policy. No runtime state.
 *   AgentInstance    — one operational instance of a descriptor, with a
 *                      transient operational state.
 *   Assignment       — a task bound to an instance, with qualification evidence
 *                      (see `contracts/assignment.ts`).
 *   ExecutionSession — one governed execution (see `core/execution`).
 *
 * The separations that must never collapse:
 *
 *   AGENT            != MODEL != PROVIDER != ENVIRONMENT != TOOL != PROJECT
 *   DESCRIPTOR       != INSTANCE
 *   AVAILABLE        != QUALIFIED != ASSIGNED != EXECUTING != SUCCESSFUL
 *   CAPABLE          != AUTHORIZED
 *   IMPLEMENTER      != REVIEWER
 *   PROJECT ACCESS   != TOOL ACCESS  != UNLIMITED AUTHORITY
 *
 * `AGENT != ROLE NAME`: a role is an attribute of a descriptor, never an
 * identifier. Two descriptors may share a role; one descriptor has exactly one
 * identity (`id`) and a monotonically increasing `version`.
 */
import { ValidationError } from "./index.js";
import { EXECUTION_CAPABILITIES } from "./execution.js";
import { canonicalizeCapabilities, isCapabilityId, MAX_CAPABILITY_ID_LENGTH, parentCapability, } from "./capabilities.js";
import { validateAgent } from "./index.js";
/* ------------------------------------------------------------------ */
/* Administrative lifecycle                                           */
/* ------------------------------------------------------------------ */
/**
 * WHO the agent is allowed to be. This is the operator-controlled lifecycle
 * and is orthogonal to the operational state: an agent can be administratively
 * `active` while operationally `blocked`. `retired` is terminal and preserves
 * historical identity — an agent is never silently deleted, because past
 * executions must remain attributable to the definition that produced them.
 */
export const AGENT_ADMINISTRATIVE_STATUSES = [
    "draft",
    "active",
    "suspended",
    "disabled",
    "retired",
];
/** Legal administrative transitions. Anything else throws. */
const ADMINISTRATIVE_TRANSITIONS = Object.freeze({
    draft: ["active", "retired"],
    active: ["suspended", "disabled", "retired"],
    // A suspended agent is re-enabled by returning to `active`, never by
    // resurrecting itself from `disabled`.
    suspended: ["active", "disabled", "retired"],
    disabled: ["active", "retired"],
    retired: [],
});
export function canTransitionAdministrative(from, to) {
    return ADMINISTRATIVE_TRANSITIONS[from].includes(to);
}
/**
 * May an agent in this administrative state receive NEW work?
 * `suspended`, `disabled` and `retired` may not. This is checked at the
 * assignment boundary, never inferred from a UI badge.
 */
export function acceptsNewAssignments(status) {
    return status === "active";
}
/* ------------------------------------------------------------------ */
/* Operational state                                                  */
/* ------------------------------------------------------------------ */
/**
 * WHAT the agent is doing right now. This is derived from authoritative task /
 * assignment / execution records — it is never set by a client and never
 * animated for effect. Operational state says nothing about authority: a
 * `busy` agent and an `available` agent have exactly the same policies.
 */
export const AGENT_INSTANCE_STATES = [
    "available",
    "assigned",
    "busy",
    "waiting",
    "blocked",
    "offline",
];
/* ------------------------------------------------------------------ */
/* Risk                                                               */
/* ------------------------------------------------------------------ */
export const AGENT_RISK_LEVELS = [
    "low",
    "moderate",
    "high",
    "critical",
];
const RISK_RANK = Object.freeze({
    low: 0,
    moderate: 1,
    high: 2,
    critical: 3,
});
/** Is `actual` at or below the `ceiling`? A ceiling can never be exceeded. */
export function riskWithinCeiling(actual, ceiling) {
    return RISK_RANK[actual] <= RISK_RANK[ceiling];
}
/* ------------------------------------------------------------------ */
/* Descriptor                                                         */
/* ------------------------------------------------------------------ */
export const MAX_AGENT_ID_LENGTH = 64;
export const MAX_AGENT_DEFINITIONS = 512;
/** Prototype-polluting keys can never be an agent id. */
const FORBIDDEN_ID_KEYS = new Set([
    "__proto__",
    "constructor",
    "prototype",
]);
export function isSafeIdentifier(value) {
    return (typeof value === "string" &&
        value.length > 0 &&
        value.length <= MAX_AGENT_ID_LENGTH &&
        !FORBIDDEN_ID_KEYS.has(value) &&
        /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value));
}
/**
 * A caller PRINCIPAL, not a resource identifier.
 *
 * Principals legitimately contain a `:` separator (`user:admin`,
 * `system:reassign`) and may be longer than an agent id, so they get their own
 * rule. The prototype-pollution guard is retained: `__proto__` is a legal
 * string in JavaScript and must never be accepted as a principal.
 */
export function isSafePrincipal(value) {
    return (typeof value === "string" &&
        value.length > 0 &&
        value.length <= 200 &&
        !FORBIDDEN_ID_KEYS.has(value) &&
        /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/.test(value));
}
export function validateSpecialistTask(raw) {
    if (typeof raw !== "object" || raw === null)
        throw new ValidationError("task must be an object");
    const t = raw;
    if (typeof t.objective !== "string")
        throw new ValidationError("objective must be a string");
    return {
        objective: t.objective,
        context: Array.isArray(t.context) ? t.context.map(String) : [],
        instructions: typeof t.instructions === "string" ? t.instructions : "",
        acceptanceCriteria: Array.isArray(t.acceptanceCriteria)
            ? t.acceptanceCriteria.map(String)
            : [],
    };
}
export function validateSpecialistResult(raw) {
    if (typeof raw !== "object" || raw === null)
        throw new ValidationError("result must be an object");
    const r = raw;
    if (typeof r.taskId !== "string")
        throw new ValidationError("taskId is required");
    if (typeof r.summary !== "string")
        throw new ValidationError("summary is required");
}
/* ------------------------------------------------------------------ */
/* Validation                                                         */
/* ------------------------------------------------------------------ */
function requireText(value, field, max = 200) {
    if (typeof value !== "string" || value.trim() === "") {
        throw new ValidationError(`${field} must be a non-empty string`);
    }
    if (value.length > max) {
        throw new ValidationError(`${field} must be at most ${max} characters`);
    }
}
function requireStringList(value, field, maxItems, maxLength = MAX_CAPABILITY_ID_LENGTH) {
    if (!Array.isArray(value)) {
        throw new ValidationError(`${field} must be an array`);
    }
    if (value.length > maxItems) {
        throw new ValidationError(`${field} must contain at most ${maxItems} entries`);
    }
    for (const [index, entry] of value.entries()) {
        requireText(entry, `${field}[${index}]`, maxLength);
    }
    return value;
}
function requireExecutionCapabilities(value, field) {
    const list = requireStringList(value, field, EXECUTION_CAPABILITIES.length);
    for (const entry of list) {
        if (!EXECUTION_CAPABILITIES.includes(entry)) {
            throw new ValidationError(`${field} contains unknown execution capability: ${JSON.stringify(entry)}`);
        }
    }
    return list;
}
const UNSAFE_METADATA_KEYS = new Set([
    "__proto__",
    "constructor",
    "prototype",
]);
/** Metadata is opaque to the platform; it may never smuggle a reserved key. */
function validateSafeMetadata(value, field, depth = 0) {
    if (value === undefined)
        return;
    if (depth > 4) {
        throw new ValidationError(`${field} is nested too deeply`);
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new ValidationError(`${field} must be a plain object`);
    }
    for (const [key, entry] of Object.entries(value)) {
        if (UNSAFE_METADATA_KEYS.has(key)) {
            throw new ValidationError(`${field} contains a reserved key: ${key}`);
        }
        if (typeof key !== "string" || key.length > 128) {
            throw new ValidationError(`${field} contains an invalid key`);
        }
        if (typeof entry === "string" && entry.length > 4096) {
            throw new ValidationError(`${field}.${key} is too long`);
        }
        if (typeof entry === "object" && entry !== null) {
            validateSafeMetadata(entry, `${field}.${key}`, depth + 1);
        }
    }
}
/**
 * Full structural + policy validation of a descriptor.
 *
 * This is the gate that makes a descriptor *registerable*. It is deliberately
 * strict: an agent that cannot state its model policy, tool ceiling, project
 * policy and review policy is not a describable agent, and registering it
 * would produce an agent that is invisible to routing and unbounded at runtime.
 */
export function validateAgentDescriptor(descriptor) {
    if (!descriptor || typeof descriptor !== "object") {
        throw new ValidationError("agent descriptor must be an object");
    }
    if (!isSafeIdentifier(descriptor.id)) {
        throw new ValidationError("agent descriptor id must match /^[A-Za-z0-9][A-Za-z0-9._-]*$/ and be at most 64 characters");
    }
    requireText(descriptor.name, "agent.name", 120);
    requireText(descriptor.displayName, "agent.displayName", 120);
    requireText(descriptor.role, "agent.role", 80);
    requireText(descriptor.department, "agent.department", 80);
    requireText(descriptor.description, "agent.description", 2000);
    if (!AGENT_ADMINISTRATIVE_STATUSES.includes(descriptor.administrativeStatus)) {
        throw new ValidationError(`agent.administrativeStatus must be one of ${AGENT_ADMINISTRATIVE_STATUSES.join(", ")}`);
    }
    if (!Number.isInteger(descriptor.version) ||
        descriptor.version < 1 ||
        descriptor.version > 100_000) {
        throw new ValidationError("agent.version must be an integer >= 1");
    }
    if (!AGENT_RISK_LEVELS.includes(descriptor.riskProfile)) {
        throw new ValidationError("agent.riskProfile must be a known risk level");
    }
    /* capabilities — hierarchical and known, de-duplicated by canonical form */
    const rawCapabilities = requireStringList(descriptor.capabilities, "agent.capabilities", 128);
    const capabilities = canonicalizeCapabilities(rawCapabilities, "agent.capabilities");
    if (capabilities.length === 0) {
        throw new ValidationError("agent.capabilities must not be empty");
    }
    // Redundant ancestor + descendant declarations are legal but misleading.
    for (const capability of capabilities) {
        const parent = parentCapability(capability);
        if (parent && capabilities.includes(parent)) {
            throw new ValidationError(`agent.capabilities declares "${parent}" and its child "${capability}"; the parent is redundant`);
        }
    }
    // Limitations are operator-facing prose, not identifiers: bounded generously
    // but still bounded, so a descriptor can never smuggle a wall of text.
    requireStringList(descriptor.limitations, "agent.limitations", 64, 400);
    /* model policy — required, and must actually name a provider */
    const provider = descriptor.modelPolicy?.provider?.trim();
    if (typeof provider !== "string" || provider === "") {
        throw new ValidationError("agent.modelPolicy.provider is required: an agent with no model policy can never be routed to a model");
    }
    if (descriptor.modelPolicy.model !== undefined &&
        (typeof descriptor.modelPolicy.model !== "string" ||
            descriptor.modelPolicy.model.trim() === "")) {
        throw new ValidationError("agent.modelPolicy.model must be a non-empty string");
    }
    /* qualification */
    const qualification = descriptor.qualification;
    if (!qualification || typeof qualification !== "object") {
        throw new ValidationError("agent.qualification must be an object");
    }
    requireStringList(qualification.technologies, "agent.qualification.technologies", 64);
    if (!AGENT_RISK_LEVELS.includes(qualification.maxRiskLevel)) {
        throw new ValidationError("agent.qualification.maxRiskLevel must be a known risk level");
    }
    if (!riskWithinCeiling(descriptor.riskProfile, qualification.maxRiskLevel)) {
        throw new ValidationError("agent.riskProfile cannot exceed agent.qualification.maxRiskLevel");
    }
    if (!AGENT_RISK_LEVELS.includes(qualification.reviewRequiredFromRiskLevel)) {
        throw new ValidationError("agent.qualification.reviewRequiredFromRiskLevel must be a known risk level");
    }
    requireExecutionCapabilities(qualification.requiredToolCapabilities, "agent.qualification.requiredToolCapabilities");
    /* environment requirements */
    const environment = descriptor.environmentRequirements;
    if (!environment || typeof environment !== "object") {
        throw new ValidationError("agent.environmentRequirements must be an object");
    }
    const envTypes = requireStringList(environment.requiredEnvironmentTypes, "agent.environmentRequirements.requiredEnvironmentTypes", 32);
    if (typeof environment.acceptsAnyEnvironmentType !== "boolean") {
        throw new ValidationError("agent.environmentRequirements.acceptsAnyEnvironmentType must be a boolean");
    }
    if (envTypes.length > 0 && environment.acceptsAnyEnvironmentType) {
        throw new ValidationError("agent.environmentRequirements cannot both require specific environment types and accept any");
    }
    /* tool policy */
    const toolPolicy = descriptor.toolPolicy;
    if (!toolPolicy || typeof toolPolicy !== "object") {
        throw new ValidationError("agent.toolPolicy must be an object");
    }
    const maxCapabilities = requireExecutionCapabilities(toolPolicy.maxExecutionCapabilities, "agent.toolPolicy.maxExecutionCapabilities");
    const deniedCapabilities = requireExecutionCapabilities(toolPolicy.deniedExecutionCapabilities, "agent.toolPolicy.deniedExecutionCapabilities");
    if (toolPolicy.allowsUnrestrictedShell !== false) {
        throw new ValidationError("agent.toolPolicy.allowsUnrestrictedShell must be false: no agent holds unrestricted shell authority");
    }
    const overlap = maxCapabilities.filter((c) => deniedCapabilities.includes(c));
    if (overlap.length > 0) {
        throw new ValidationError(`agent.toolPolicy both allows and denies: ${overlap.join(", ")}`);
    }
    /* project policy — deny by default, and it must agree with the base Agent */
    const projectPolicy = descriptor.projectPolicy;
    if (!projectPolicy || typeof projectPolicy !== "object") {
        throw new ValidationError("agent.projectPolicy must be an object");
    }
    if (projectPolicy.mode !== "allow_list") {
        throw new ValidationError('agent.projectPolicy.mode must be "allow_list"');
    }
    const projects = requireStringList(projectPolicy.projects, "agent.projectPolicy.projects", 256);
    for (const project of projects) {
        if (!isSafeIdentifier(project)) {
            throw new ValidationError(`agent.projectPolicy.projects contains an invalid project id: ${JSON.stringify(project)}`);
        }
    }
    const declaredProjects = [...descriptor.allowedProjects].sort();
    if (declaredProjects.join(" ") !== [...projects].sort().join(" ")) {
        throw new ValidationError("agent.allowedProjects must equal agent.projectPolicy.projects");
    }
    /* review policy — self review is never permitted */
    const reviewPolicy = descriptor.reviewPolicy;
    if (!reviewPolicy || typeof reviewPolicy !== "object") {
        throw new ValidationError("agent.reviewPolicy must be an object");
    }
    if (typeof reviewPolicy.requiresIndependentReview !== "boolean") {
        throw new ValidationError("agent.reviewPolicy.requiresIndependentReview must be a boolean");
    }
    if (!Number.isInteger(reviewPolicy.minimumReviewers) ||
        reviewPolicy.minimumReviewers < 0 ||
        reviewPolicy.minimumReviewers > 8) {
        throw new ValidationError("agent.reviewPolicy.minimumReviewers must be an integer between 0 and 8");
    }
    if (reviewPolicy.selfReviewAllowed !== false) {
        throw new ValidationError("agent.reviewPolicy.selfReviewAllowed must be false: an implementer may never review its own change");
    }
    if (reviewPolicy.requiresIndependentReview &&
        reviewPolicy.minimumReviewers < 1) {
        throw new ValidationError("agent.reviewPolicy requires independent review but demands fewer than one reviewer");
    }
    /* handoff policy */
    const handoffPolicy = descriptor.handoffPolicy;
    if (!handoffPolicy || typeof handoffPolicy !== "object") {
        throw new ValidationError("agent.handoffPolicy must be an object");
    }
    const delegates = requireStringList(handoffPolicy.canDelegateTo, "agent.handoffPolicy.canDelegateTo", 64);
    for (const capability of delegates) {
        if (!isCapabilityId(capability)) {
            throw new ValidationError(`agent.handoffPolicy.canDelegateTo contains a non-canonical capability: ${JSON.stringify(capability)}`);
        }
        if (capabilities.includes(capability)) {
            throw new ValidationError(`agent.handoffPolicy.canDelegateTo declares "${capability}", which the agent itself provides`);
        }
    }
    if (typeof handoffPolicy.requiresDestinationAcceptance !== "boolean") {
        throw new ValidationError("agent.handoffPolicy.requiresDestinationAcceptance must be a boolean");
    }
    /* cost policy */
    const costPolicy = descriptor.costPolicy;
    if (!costPolicy || typeof costPolicy !== "object") {
        throw new ValidationError("agent.costPolicy must be an object");
    }
    requireText(costPolicy.costCenter, "agent.costPolicy.costCenter", 80);
    if (costPolicy.maxCostPerExecutionUsd !== undefined &&
        (!Number.isFinite(costPolicy.maxCostPerExecutionUsd) ||
            costPolicy.maxCostPerExecutionUsd <= 0)) {
        throw new ValidationError("agent.costPolicy.maxCostPerExecutionUsd must be a positive finite number when declared");
    }
    if (costPolicy.attestsUsage !== true) {
        throw new ValidationError("agent.costPolicy.attestsUsage must be true: UNKNOWN COST IS NOT ZERO COST");
    }
    validateSafeMetadata(descriptor.metadata, "agent.metadata");
    if (descriptor.avatarUrl !== undefined) {
        requireText(descriptor.avatarUrl, "agent.avatarUrl", 2048);
    }
    if (descriptor.costPerHour !== undefined &&
        (!Number.isFinite(descriptor.costPerHour) || descriptor.costPerHour < 0)) {
        throw new ValidationError("agent.costPerHour must be a non-negative number");
    }
    // The base Agent validator still runs: the descriptor must remain a valid,
    // registrable Agent, and any base-contract violation is a descriptor bug.
    validateAgent(descriptor);
}
/** An operational instance must point at a real descriptor and a real state. */
export function validateAgentInstance(instance) {
    if (!instance || typeof instance !== "object") {
        throw new ValidationError("agent instance must be an object");
    }
    if (!isSafeIdentifier(instance.id)) {
        throw new ValidationError("agent instance id is invalid");
    }
    if (!isSafeIdentifier(instance.descriptorId)) {
        throw new ValidationError("agent instance descriptorId is invalid");
    }
    if (!Number.isInteger(instance.descriptorVersion) ||
        instance.descriptorVersion < 1) {
        throw new ValidationError("agent instance descriptorVersion must be an integer >= 1");
    }
    if (!AGENT_INSTANCE_STATES.includes(instance.operationalState)) {
        throw new ValidationError("agent instance operationalState is not a known state");
    }
    if (instance.projectId !== undefined &&
        !isSafeIdentifier(instance.projectId)) {
        throw new ValidationError("agent instance projectId is invalid");
    }
    validateSafeMetadata(instance.metadata, "agent instance metadata");
}
