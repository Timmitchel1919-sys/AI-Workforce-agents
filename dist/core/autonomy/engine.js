/**
 * Autonomous workflow engine.
 *
 * TRIGGER → CONTEXT → PLAN → RISK → APPROVAL POLICY → EXECUTION → OBSERVATION → VALIDATION →
 * RECOVERY → REPORT. The engine owns only workflow state; every action runs through an injected
 * executor (which itself uses the Tool Gateway / orchestrator), and the owner's approval is
 * requested through the existing approval system. Time-based work (retry delays, schedule
 * triggers) is advanced by `tick()`; there are no hidden timers.
 */
import { randomBytes } from "node:crypto";
import { OPS_AUTONOMY_LEVELS, TRIGGER_SOURCES, } from "../../contracts/autonomy.js";
import { SyncCache } from "../knowledge-memory/memory-service.js";
import { maskSecrets } from "../prompt-intelligence/secret-scan.js";
import { ACTIONS, BUILTIN_DEFINITIONS, DEFAULT_RETRY, RISK_ORDER, UNKNOWN_ACTION, actionOf, decideStep, maxRisk, } from "./catalog.js";
export class AutonomyError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "AutonomyError";
    }
}
const id = (p) => `${p}-${randomBytes(4).toString("hex")}`;
const TERMINAL = [
    "COMPLETED",
    "FAILED",
    "ESCALATED",
    "REJECTED",
    "CANCELLED",
];
const OPEN_STATES = [
    "TRIGGERED",
    "PLANNED",
    "AWAITING_PLAN_APPROVAL",
    "EXECUTING",
    "AWAITING_APPROVAL",
    "RECOVERING",
    "BLOCKED",
    "PAUSED",
];
const bounded = (s, n = 2000) => maskSecrets(String(s)).slice(0, n);
export class AutonomyEngine {
    ports;
    settings;
    globalRepo;
    definitions;
    rules;
    instances;
    auditRepo;
    running = new Set();
    seq = 0;
    constructor(repos, ports) {
        this.ports = ports;
        this.settings = new SyncCache(repos.settings);
        this.globalRepo = new SyncCache(repos.global);
        this.definitions = new SyncCache(repos.definitions);
        this.rules = new SyncCache(repos.rules);
        this.instances = new SyncCache(repos.instances);
        this.auditRepo = new SyncCache(repos.audit);
        this.seq = this.auditRepo.list().length;
        const now = this.ports.clock();
        if (!this.globalRepo.findById("global"))
            this.globalRepo.upsert({
                id: "global",
                paused: false,
                updatedAt: now,
                updatedBy: "system",
            });
        for (const d of BUILTIN_DEFINITIONS)
            if (!this.definitions.findById(d.definitionId))
                this.definitions.upsert({
                    ...d,
                    id: d.definitionId,
                    createdAt: now,
                    createdBy: "system",
                });
    }
    /* ------------------------------ audit/ledger ------------------------------ */
    audit(kind, actor, detail, extra = {}) {
        const ev = {
            id: `au-${String(++this.seq).padStart(9, "0")}`,
            at: this.ports.clock(),
            kind,
            actor,
            detail: bounded(detail, 400),
            ...extra,
        };
        this.auditRepo.upsert(ev);
        this.ports.ledger.record(`autonomy.${kind.toLowerCase()}`, {
            actor,
            ...(extra.projectId ? { projectId: extra.projectId } : {}),
            ...(extra.risk ? { risk: extra.risk } : {}),
            result: "OK",
            detail: {
                ...(extra.instanceId ? { instanceId: extra.instanceId } : {}),
                ...(extra.stepId ? { stepId: extra.stepId } : {}),
                note: ev.detail,
            },
        });
    }
    auditTrail(filter = {}) {
        return this.auditRepo
            .list()
            .filter((e) => (!filter.instanceId || e.instanceId === filter.instanceId) &&
            (!filter.projectId || e.projectId === filter.projectId))
            .sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id))
            .slice(0, Math.min(filter.limit ?? 100, 500));
    }
    /* -------------------------------- settings -------------------------------- */
    levelOf(projectId) {
        return (this.settings.findById(projectId)?.level ?? this.defaultLevel(projectId));
    }
    defaultLevel(projectId) {
        const onboarded = this.ports.onboardingLevel?.(projectId);
        return typeof onboarded === "number" &&
            OPS_AUTONOMY_LEVELS.includes(onboarded)
            ? onboarded
            : 1;
    }
    settingOf(projectId) {
        return (this.settings.findById(projectId) ?? {
            id: projectId,
            projectId,
            level: this.defaultLevel(projectId),
            updatedAt: this.ports.clock(),
            updatedBy: "onboarding default",
        });
    }
    /** Only a human principal may change a level; callers must never pass an agent/workflow identity. */
    setLevel(projectId, level, by, opts = {}) {
        if (!this.ports.projectExists(projectId))
            throw new AutonomyError("not_found", "project not found");
        if (typeof level !== "number" ||
            !OPS_AUTONOMY_LEVELS.includes(level))
            throw new AutonomyError("invalid_request", "level must be 0–5");
        if (level === 5 && !opts.confirmHighest)
            throw new AutonomyError("invalid_request", "level 5 must be confirmed explicitly");
        const next = {
            id: projectId,
            projectId,
            level: level,
            updatedAt: this.ports.clock(),
            updatedBy: by,
            ...(opts.note ? { note: opts.note.slice(0, 200) } : {}),
        };
        this.settings.upsert(next);
        this.audit("CONTROL", by, `autonomy level set to ${level}`, {
            projectId,
            risk: level >= 4 ? "HIGH" : "LOW",
        });
        return next;
    }
    listSettings() {
        return this.settings.list();
    }
    globalState() {
        return this.globalRepo.findById("global");
    }
    pauseAll(by, reason) {
        const next = {
            ...this.globalState(),
            paused: true,
            reason: bounded(reason, 200),
            updatedAt: this.ports.clock(),
            updatedBy: by,
        };
        this.globalRepo.upsert(next);
        this.audit("CONTROL", by, `all autonomous operation paused: ${next.reason}`, { risk: "HIGH" });
        return next;
    }
    resumeAll(by) {
        const { reason: _r, ...rest } = this.globalState();
        void _r;
        const next = {
            ...rest,
            paused: false,
            updatedAt: this.ports.clock(),
            updatedBy: by,
        };
        this.globalRepo.upsert(next);
        this.audit("CONTROL", by, "autonomous operation resumed");
        return next;
    }
    /* ---------------------------- definitions & rules ---------------------------- */
    listDefinitions() {
        return this.definitions.list().sort((a, b) => a.name.localeCompare(b.name));
    }
    definition(definitionId) {
        const d = this.definitions.findById(definitionId);
        if (!d)
            throw new AutonomyError("not_found", "workflow definition not found");
        return d;
    }
    actions() {
        return ACTIONS;
    }
    createDefinition(input, by) {
        const name = typeof input["name"] === "string"
            ? input["name"].trim().slice(0, 100)
            : "";
        if (!name)
            throw new AutonomyError("invalid_request", "name is required");
        const steps = Array.isArray(input["steps"])
            ? input["steps"]
            : [];
        if (steps.length === 0 || steps.length > 20)
            throw new AutonomyError("invalid_request", "a workflow needs 1–20 steps");
        const seen = new Set();
        const defs = steps.map((s, i) => {
            const stepId = typeof s["stepId"] === "string" &&
                /^[a-z][a-z0-9_-]{0,30}$/.test(s["stepId"])
                ? s["stepId"]
                : `s${i + 1}`;
            if (seen.has(stepId))
                throw new AutonomyError("invalid_request", `duplicate step id "${stepId}"`);
            seen.add(stepId);
            const actionId = typeof s["actionId"] === "string" ? s["actionId"] : "";
            if (!actionOf(actionId))
                throw new AutonomyError("invalid_request", `unknown action "${actionId}"`);
            const params = {};
            if (s["params"] && typeof s["params"] === "object")
                for (const [k, v] of Object.entries(s["params"]))
                    if (typeof v === "string" ||
                        typeof v === "number" ||
                        typeof v === "boolean")
                        params[k] = typeof v === "string" ? bounded(v, 300) : v;
            return {
                stepId,
                actionId,
                description: typeof s["description"] === "string"
                    ? s["description"].slice(0, 200)
                    : actionOf(actionId).label,
                params,
            };
        });
        const allowed = [...new Set(defs.map((s) => s.actionId))];
        const risk = defs.reduce((m, s) => maxRisk(m, actionOf(s.actionId).risk), "LOW");
        const now = this.ports.clock();
        const def = {
            id: id("wf"),
            definitionId: "",
            name,
            description: typeof input["description"] === "string"
                ? input["description"].slice(0, 400)
                : "",
            steps: defs,
            boundaries: { allowedActions: allowed, maxRisk: risk },
            retry: DEFAULT_RETRY,
            builtin: false,
            createdAt: now,
            createdBy: by,
        };
        def.definitionId = def.id;
        this.definitions.upsert(def);
        this.audit("CONTROL", by, `workflow definition created: ${name}`);
        return def;
    }
    listRules(projectId) {
        return this.rules
            .list()
            .filter((r) => !projectId || r.projectId === projectId);
    }
    addRule(input, by) {
        const projectId = typeof input["projectId"] === "string" ? input["projectId"] : "";
        if (!this.ports.projectExists(projectId))
            throw new AutonomyError("not_found", "project not found");
        if (!TRIGGER_SOURCES.includes(input["source"]))
            throw new AutonomyError("invalid_request", `source must be one of ${TRIGGER_SOURCES.join(", ")}`);
        const definitionId = typeof input["definitionId"] === "string" ? input["definitionId"] : "";
        this.definition(definitionId);
        const rule = {
            id: id("rule"),
            ruleId: "",
            projectId,
            source: input["source"],
            ...(typeof input["eventType"] === "string" && input["eventType"]
                ? { eventType: input["eventType"].slice(0, 100) }
                : {}),
            definitionId,
            enabled: true,
            createdAt: this.ports.clock(),
            createdBy: by,
        };
        rule.ruleId = rule.id;
        this.rules.upsert(rule);
        this.audit("CONTROL", by, `trigger rule added: ${rule.source} → ${definitionId}`, { projectId });
        return rule;
    }
    setRuleEnabled(ruleId, enabled, by) {
        const r = this.rules.findById(ruleId);
        if (!r)
            throw new AutonomyError("not_found", "rule not found");
        const next = { ...r, enabled };
        this.rules.upsert(next);
        this.audit("CONTROL", by, `trigger rule ${enabled ? "enabled" : "disabled"}`, { projectId: r.projectId });
        return next;
    }
    /* --------------------------------- triggers --------------------------------- */
    /** An event arrives (webhook, schedule tick, monitoring…). Matching enabled rules create instances; duplicates are ignored. */
    async ingestEvent(e) {
        const created = [];
        if (!this.ports.projectExists(e.projectId))
            return created;
        for (const rule of this.rules.list()) {
            if (!rule.enabled ||
                rule.projectId !== e.projectId ||
                rule.source !== e.source)
                continue;
            if (rule.eventType && rule.eventType !== e.eventType)
                continue;
            const dedupe = e.ref ? `${rule.ruleId}:${e.ref}` : undefined;
            if (dedupe &&
                this.instances
                    .list()
                    .some((i) => i.trigger.ref === e.ref && i.trigger.ruleId === rule.ruleId))
                continue;
            created.push(await this.create(rule.definitionId, e.projectId, {
                source: e.source,
                summary: e.summary,
                ...(e.ref ? { ref: e.ref } : {}),
                ruleId: rule.ruleId,
                by: e.by ?? "system",
            }));
        }
        return created;
    }
    /** CONTEXT → PLAN → RISK. Creating an instance never executes a step on its own except when policy allows an auto-start. */
    async create(definitionId, projectId, trigger) {
        const def = this.definition(definitionId);
        if (!this.ports.projectExists(projectId))
            throw new AutonomyError("not_found", "project not found");
        const level = this.levelOf(projectId);
        const now = this.ports.clock();
        const steps = def.steps.map((s) => {
            const a = actionOf(s.actionId) ?? UNKNOWN_ACTION;
            return {
                stepId: s.stepId,
                actionId: s.actionId,
                description: s.description,
                params: { ...(s.params ?? {}) },
                state: "PENDING",
                risk: a.risk,
                automatic: null,
                attempts: 0,
            };
        });
        const plan = this.buildPlan(def, projectId, level, steps, trigger.summary);
        const inst = {
            id: id("inst"),
            instanceId: "",
            definitionId,
            name: def.name,
            projectId,
            level,
            state: "TRIGGERED",
            stateReason: "triggered",
            trigger,
            plan,
            planApproved: false,
            steps,
            retry: def.retry,
            boundaries: def.boundaries,
            createdAt: now,
            updatedAt: now,
        };
        inst.instanceId = inst.id;
        this.instances.upsert(inst);
        this.audit("TRIGGER", trigger.by, `${trigger.source}: ${trigger.summary}`, {
            instanceId: inst.id,
            projectId,
        });
        this.audit("PLAN", "autonomy-engine", `${plan.autoSteps} automatic and ${plan.approvalsExpected} approval step(s); max risk ${plan.maxRisk}`, { instanceId: inst.id, projectId, risk: plan.maxRisk });
        this.audit("AGENT", "autonomy-engine", plan.agentHint, {
            instanceId: inst.id,
            projectId,
        });
        this.audit("MODEL", "autonomy-engine", plan.modelPolicy, {
            instanceId: inst.id,
            projectId,
        });
        // Policy decides the first state.
        const autoStart = level >= 4 &&
            RISK_ORDER[plan.maxRisk] <= RISK_ORDER.MEDIUM &&
            trigger.source !== "user_command";
        if (level === 3 ||
            (level >= 4 && !autoStart && trigger.source !== "user_command"))
            this.set(inst, "AWAITING_PLAN_APPROVAL", "the plan needs the owner's approval before it runs");
        else
            this.set(inst, "PLANNED", level <= 2 ? "planned; waiting for the owner to start it" : "planned");
        if (autoStart) {
            inst.planApproved = true;
            this.audit("POLICY", "autonomy-engine", `auto-start: level ${level}, max risk ${plan.maxRisk}`, { instanceId: inst.id, projectId });
            this.instances.upsert(inst);
            await this.advance(inst.id, "autonomy-engine");
        }
        return this.get(inst.id);
    }
    buildPlan(def, projectId, level, steps, summary) {
        let top = "LOW";
        let auto = 0;
        let approvals = 0;
        const risks = [];
        const tools = new Set();
        for (const s of steps) {
            const a = actionOf(s.actionId) ?? UNKNOWN_ACTION;
            top = maxRisk(top, a.risk);
            tools.add(a.kind);
            const d = decideStep({
                action: a,
                risk: a.risk,
                level,
                planApproved: true,
                boundaries: def.boundaries,
                startedByOwner: false,
            });
            if (d.outcome === "AUTO")
                auto++;
            else
                approvals++;
            if (a.risk !== "LOW")
                risks.push(`${a.label}: ${a.risk} (${a.impact})`);
        }
        const reversible = steps.filter((s) => actionOf(s.actionId)?.rollbackAction).length;
        return {
            objective: `${def.name}: ${summary}`.slice(0, 300),
            context: `Project ${projectId} at autonomy level ${level}.`,
            dependencies: [...new Set(steps.map((s) => s.actionId))],
            requiredTools: [...tools],
            agentHint: "The Agent Router selects the specialised agent for each orchestrated task; this workflow does not assign agents itself.",
            modelPolicy: "The Model Router selects the model at execution time; no model is hard-coded.",
            environment: this.ports.environmentOf?.(projectId) ?? "DEVELOPMENT",
            expectedResult: def.description ||
                `Complete ${steps.length} step(s) and produce a report.`,
            risks,
            rollback: reversible > 0
                ? `${reversible} of ${steps.length} step(s) have a defined reversal; rollback is attempted only on the owner's command.`
                : "No step in this workflow can be rolled back automatically.",
            maxRisk: top,
            approvalsExpected: approvals,
            autoSteps: auto,
            generatedAt: this.ports.clock(),
        };
    }
    /* ----------------------------------- reads ----------------------------------- */
    get(instanceId) {
        const i = this.instances.findById(instanceId);
        if (!i)
            throw new AutonomyError("not_found", "workflow not found");
        return i;
    }
    list(filter = {}) {
        return this.instances
            .list()
            .filter((i) => (!filter.projectId || i.projectId === filter.projectId) &&
            (!filter.states || filter.states.includes(i.state)))
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }
    set(i, state, reason) {
        i.state = state;
        i.stateReason = bounded(reason, 300);
        i.updatedAt = this.ports.clock();
        if (TERMINAL.includes(state))
            i.finishedAt = i.updatedAt;
        this.instances.upsert(i);
    }
    /* ------------------------------- owner controls ------------------------------- */
    approvePlan(instanceId, by) {
        const i = this.get(instanceId);
        if (i.state !== "AWAITING_PLAN_APPROVAL" && i.state !== "PLANNED")
            throw new AutonomyError("invalid_state", `the workflow is ${i.state}`);
        i.planApproved = true;
        this.set(i, "PLANNED", "plan approved by the owner");
        this.audit("APPROVAL", by, "plan approved", {
            instanceId,
            projectId: i.projectId,
            risk: i.plan.maxRisk,
        });
        return i;
    }
    async start(instanceId, by) {
        const i = this.get(instanceId);
        if (i.state !== "PLANNED" && i.state !== "AWAITING_PLAN_APPROVAL")
            throw new AutonomyError("invalid_state", `the workflow is ${i.state}`);
        if (i.state === "AWAITING_PLAN_APPROVAL" && i.level >= 3)
            throw new AutonomyError("invalid_state", "approve the plan first");
        i.planApproved = true; // the owner starting it by hand is their go-ahead
        this.audit("CONTROL", by, "workflow started by the owner", {
            instanceId,
            projectId: i.projectId,
        });
        return this.advance(instanceId, by);
    }
    cancel(instanceId, by) {
        const i = this.get(instanceId);
        if (TERMINAL.includes(i.state))
            throw new AutonomyError("invalid_state", `the workflow is already ${i.state}`);
        for (const s of i.steps)
            if ([
                "PENDING",
                "WAITING_APPROVAL",
                "RETRY_WAIT",
                "BLOCKED",
                "APPROVED",
            ].includes(s.state))
                s.state = "SKIPPED";
        this.set(i, "CANCELLED", `cancelled by ${by}`);
        this.audit("CONTROL", by, "workflow cancelled", {
            instanceId,
            projectId: i.projectId,
        });
        return i;
    }
    async decideStep(instanceId, stepId, decision, by, edit) {
        const i = this.get(instanceId);
        const step = i.steps.find((s) => s.stepId === stepId);
        if (!step)
            throw new AutonomyError("not_found", "step not found");
        if (decision === "CANCEL")
            return this.cancel(instanceId, by);
        if (step.state !== "WAITING_APPROVAL")
            throw new AutonomyError("invalid_state", `the step is ${step.state}, not waiting for approval`);
        const approvalId = step.gate?.approvalId;
        if (decision === "REJECT") {
            step.state = "REJECTED";
            for (const s of i.steps)
                if (["PENDING", "WAITING_APPROVAL"].includes(s.state))
                    s.state = "SKIPPED";
            if (approvalId)
                this.ports.decideApproval?.(approvalId, "deny", by);
            this.set(i, "REJECTED", `the owner rejected "${step.description}"`);
            this.audit("APPROVAL", by, `rejected ${step.actionId}`, {
                instanceId,
                projectId: i.projectId,
                stepId,
                risk: step.risk,
            });
            return i;
        }
        if (decision === "EDIT") {
            if (!edit || typeof edit !== "object")
                throw new AutonomyError("invalid_request", "edit needs new parameters");
            const params = {};
            for (const [k, v] of Object.entries(edit))
                if (typeof v === "string" ||
                    typeof v === "number" ||
                    typeof v === "boolean")
                    params[k] = typeof v === "string" ? bounded(v, 300) : v;
            if (approvalId)
                this.ports.decideApproval?.(approvalId, "deny", by);
            step.params = params;
            step.state = "PENDING";
            delete step.gate;
            this.audit("APPROVAL", by, `edited ${step.actionId}; it will be assessed again`, { instanceId, projectId: i.projectId, stepId, risk: step.risk });
            this.set(i, "EXECUTING", "step edited; re-assessing");
            return this.advance(instanceId, by);
        }
        step.state = "APPROVED";
        step.approvedBy = by;
        if (approvalId)
            this.ports.decideApproval?.(approvalId, "approve", by);
        this.audit("APPROVAL", by, `approved ${step.actionId}`, {
            instanceId,
            projectId: i.projectId,
            stepId,
            risk: step.risk,
        });
        return this.advance(instanceId, by);
    }
    /* ---------------------------------- engine ---------------------------------- */
    /** Advance every runnable workflow: due retries, approvals decided elsewhere, paused ones that may resume. */
    async tick() {
        let advanced = 0;
        for (const i of this.instances.list()) {
            if (!OPEN_STATES.includes(i.state))
                continue;
            this.reconcileApprovals(i);
            if ([
                "EXECUTING",
                "RECOVERING",
                "PAUSED",
                "AWAITING_APPROVAL",
                "BLOCKED",
            ].includes(i.state)) {
                await this.advance(i.instanceId, "autonomy-engine");
                advanced++;
            }
        }
        return { advanced };
    }
    /** The owner may decide in the central approvals queue instead of the Operations Center. */
    reconcileApprovals(i) {
        for (const s of i.steps) {
            if (s.state !== "WAITING_APPROVAL" || !s.gate?.approvalId)
                continue;
            const st = this.ports.approvalState(s.gate.approvalId);
            if (st === "approved") {
                s.state = "APPROVED";
                s.approvedBy = "owner (approvals queue)";
                this.audit("APPROVAL", "owner", `approved ${s.actionId} in the approvals queue`, {
                    instanceId: i.instanceId,
                    projectId: i.projectId,
                    stepId: s.stepId,
                    risk: s.risk,
                });
            }
            else if (st === "rejected" || st === "expired") {
                s.state = "REJECTED";
                for (const o of i.steps)
                    if (["PENDING", "WAITING_APPROVAL"].includes(o.state))
                        o.state = "SKIPPED";
                this.set(i, "REJECTED", `the approval was ${st}`);
                this.audit("APPROVAL", "owner", `${st} ${s.actionId}`, {
                    instanceId: i.instanceId,
                    projectId: i.projectId,
                    stepId: s.stepId,
                    risk: s.risk,
                });
            }
        }
        this.instances.upsert(i);
    }
    async advance(instanceId, by) {
        if (this.running.has(instanceId))
            return this.get(instanceId);
        this.running.add(instanceId);
        try {
            const i = this.get(instanceId);
            if (TERMINAL.includes(i.state))
                return i;
            for (let guard = 0; guard < 50; guard++) {
                if (this.ports.emergencyStopped()) {
                    this.set(i, "PAUSED", "the platform emergency stop is engaged");
                    this.audit("POLICY", "autonomy-engine", "paused: emergency stop", {
                        instanceId,
                        projectId: i.projectId,
                        risk: "HIGH",
                    });
                    return i;
                }
                if (this.globalState().paused) {
                    this.set(i, "PAUSED", `autonomous operation is paused${this.globalState().reason ? `: ${this.globalState().reason}` : ""}`);
                    return i;
                }
                this.reconcileApprovals(i);
                if (TERMINAL.includes(i.state))
                    return i;
                const step = i.steps.find((s) => [
                    "PENDING",
                    "APPROVED",
                    "RETRY_WAIT",
                    "WAITING_APPROVAL",
                    "BLOCKED",
                ].includes(s.state));
                if (!step) {
                    this.finish(i);
                    return i;
                }
                if (step.state === "WAITING_APPROVAL") {
                    this.set(i, "AWAITING_APPROVAL", `waiting for the owner: ${step.description}`);
                    return i;
                }
                if (step.state === "RETRY_WAIT" &&
                    step.notBefore &&
                    Date.parse(step.notBefore) > this.ports.now()) {
                    this.set(i, "RECOVERING", `retry of "${step.description}" is due at ${step.notBefore}`);
                    return i;
                }
                if (step.state === "BLOCKED") {
                    // Re-check availability: a blocked step may become runnable (for example a connector was set up).
                    if (!this.ports.executor.available(step.actionId).ok) {
                        this.set(i, "BLOCKED", step.note ?? "blocked");
                        return i;
                    }
                    step.state = "PENDING";
                }
                const action = actionOf(step.actionId) ?? UNKNOWN_ACTION;
                if (step.state === "PENDING") {
                    const decision = decideStep({
                        action,
                        risk: step.risk,
                        level: this.levelOf(i.projectId),
                        planApproved: i.planApproved,
                        boundaries: i.boundaries,
                        startedByOwner: i.trigger.source === "user_command",
                    });
                    if (decision.outcome === "REFUSED") {
                        step.state = "BLOCKED";
                        step.note = decision.reason;
                        this.audit("POLICY", "autonomy-engine", `refused ${step.actionId}: ${decision.reason}`, {
                            instanceId,
                            projectId: i.projectId,
                            stepId: step.stepId,
                            risk: step.risk,
                        });
                        this.set(i, "BLOCKED", decision.reason);
                        return i;
                    }
                    step.automatic = decision.outcome === "AUTO";
                    if (decision.outcome === "NEEDS_APPROVAL") {
                        const gate = this.gateFor(i, step, action, decision.reason);
                        step.gate = gate;
                        step.state = "WAITING_APPROVAL";
                        this.audit("POLICY", "autonomy-engine", `approval required for ${step.actionId}: ${decision.reason}`, {
                            instanceId,
                            projectId: i.projectId,
                            stepId: step.stepId,
                            risk: step.risk,
                        });
                        this.set(i, "AWAITING_APPROVAL", `waiting for the owner: ${step.description}`);
                        return i;
                    }
                }
                // Execute (AUTO, APPROVED, or a due RETRY_WAIT)
                const avail = this.ports.executor.available(step.actionId);
                if (!avail.ok) {
                    step.state = "BLOCKED";
                    step.note = avail.reason;
                    this.audit("POLICY", "autonomy-engine", `blocked ${step.actionId}: ${avail.reason}`, {
                        instanceId,
                        projectId: i.projectId,
                        stepId: step.stepId,
                        risk: step.risk,
                    });
                    this.set(i, "BLOCKED", avail.reason);
                    return i;
                }
                await this.runStep(i, step, by);
                if (TERMINAL.includes(i.state) || i.state === "RECOVERING")
                    return i;
            }
            return i;
        }
        finally {
            this.running.delete(instanceId);
        }
    }
    gateFor(i, step, action, reason) {
        const approvalId = this.ports.requestApproval({
            action: `autonomy:${step.actionId}`,
            requestedBy: "autonomy-engine",
            reason: `${i.name}: ${step.description} (${reason})`.slice(0, 300),
            metadata: {
                instanceId: i.instanceId,
                stepId: step.stepId,
                projectId: i.projectId,
                risk: step.risk,
            },
        });
        this.audit("APPROVAL", "autonomy-engine", `approval requested for ${step.actionId}`, {
            instanceId: i.instanceId,
            projectId: i.projectId,
            stepId: step.stepId,
            risk: step.risk,
        });
        return {
            proposedAction: `${action.label}${Object.keys(step.params).length
                ? ` (${Object.entries(step.params)
                    .map(([k, v]) => `${k}=${v}`)
                    .join(", ")})`
                : ""}`,
            reason,
            affectedResources: [
                i.projectId,
                ...Object.values(step.params)
                    .filter((v) => typeof v === "string")
                    .slice(0, 4),
            ],
            expectedImpact: action.impact,
            risk: step.risk,
            rollback: action.rollbackAction
                ? `Reversible by "${action.rollbackAction}" on the owner's command.`
                : "Cannot be rolled back automatically.",
            approvalId,
            requestedAt: this.ports.clock(),
        };
    }
    async runStep(i, step, by) {
        step.state = "RUNNING";
        step.attempts += 1;
        step.startedAt = this.ports.clock();
        this.set(i, "EXECUTING", `running ${step.description}`);
        this.audit("TOOL", "autonomy-engine", `executor: ${step.actionId}`, {
            instanceId: i.instanceId,
            projectId: i.projectId,
            stepId: step.stepId,
            risk: step.risk,
        });
        this.audit("ACTION", step.automatic ? "autonomy-engine" : (step.approvedBy ?? by), `${step.actionId} attempt ${step.attempts}${step.automatic ? " (automatic)" : " (approved)"}`, {
            instanceId: i.instanceId,
            projectId: i.projectId,
            stepId: step.stepId,
            risk: step.risk,
        });
        let result;
        try {
            result = await this.ports.executor.execute(step.actionId, {
                instanceId: i.instanceId,
                projectId: i.projectId,
                stepId: step.stepId,
                params: step.params,
                attempt: step.attempts,
                ...(step.approvedBy ? { approvedBy: step.approvedBy } : {}),
            });
        }
        catch (error) {
            result = {
                ok: false,
                error: {
                    kind: "PERMANENT",
                    message: error instanceof Error ? error.message : "the action failed",
                },
            };
        }
        step.finishedAt = this.ports.clock();
        if (result.ok) {
            step.state = "SUCCEEDED";
            step.output = bounded(result.output ?? "", 4000);
            this.audit("RESULT", "autonomy-engine", `${step.actionId} succeeded`, {
                instanceId: i.instanceId,
                projectId: i.projectId,
                stepId: step.stepId,
                risk: step.risk,
            });
            this.instances.upsert(i);
            return;
        }
        this.fail(i, step, result.error ?? { kind: "PERMANENT", message: "the action failed" });
    }
    /** Stop unsafe continuation, capture the error, keep state, retry only when policy and idempotency allow, else escalate. */
    fail(i, step, error) {
        const action = actionOf(step.actionId) ?? UNKNOWN_ACTION;
        const message = bounded(error.message, 300);
        step.error = { kind: error.kind, message, at: this.ports.clock() };
        this.audit("FAILURE", "autonomy-engine", `${step.actionId} failed (${error.kind}): ${message}`, {
            instanceId: i.instanceId,
            projectId: i.projectId,
            stepId: step.stepId,
            risk: step.risk,
        });
        const policy = i.retry;
        const retryable = policy.retryOn.includes(error.kind) &&
            action.idempotent &&
            step.attempts < policy.maxAttempts &&
            !action.restricted;
        if (retryable) {
            const delay = policy.baseDelayMs * 2 ** (step.attempts - 1);
            step.state = "RETRY_WAIT";
            step.notBefore = new Date(this.ports.now() + delay).toISOString();
            this.audit("RECOVERY", "autonomy-engine", `retry ${step.attempts + 1}/${policy.maxAttempts} in ${delay} ms`, {
                instanceId: i.instanceId,
                projectId: i.projectId,
                stepId: step.stepId,
            });
            this.set(i, "RECOVERING", `will retry "${step.description}" after a transient failure`);
            return;
        }
        step.state = "FAILED";
        for (const s of i.steps)
            if (["PENDING", "APPROVED", "WAITING_APPROVAL", "RETRY_WAIT"].includes(s.state))
                s.state = "SKIPPED";
        const why = !policy.retryOn.includes(error.kind)
            ? `${error.kind} failures are not retried`
            : !action.idempotent
                ? "the action is not safe to repeat"
                : step.attempts >= policy.maxAttempts
                    ? "the retry limit was reached"
                    : "retry is not permitted";
        this.audit("RECOVERY", "autonomy-engine", `not retrying: ${why}; escalating to the owner`, { instanceId: i.instanceId, projectId: i.projectId, stepId: step.stepId });
        this.set(i, "ESCALATED", `"${step.description}" failed: ${message} (${why})`);
        this.ports.raiseAlert?.({
            severity: action.risk === "LOW" ? "MEDIUM" : "HIGH",
            projectId: i.projectId,
            event: "autonomous_workflow_failed",
            description: `${i.name}: ${step.description} failed — ${message}`,
            dedupeKey: `autonomy:${i.instanceId}`,
        });
    }
    /** OBSERVATION → VALIDATION → REPORT. */
    finish(i) {
        const done = i.steps.filter((s) => s.state === "SUCCEEDED");
        const failed = i.steps.filter((s) => s.state === "FAILED" || s.state === "REJECTED");
        const reportStep = i.steps.find((s) => s.actionId === "generate_report" && s.state === "SUCCEEDED");
        const problems = [];
        if (failed.length > 0)
            problems.push(`${failed.length} step(s) did not succeed`);
        if (done.length === 0)
            problems.push("no step completed");
        for (const s of done)
            if (s.actionId === "generate_report" && !(s.output ?? "").trim())
                problems.push(`"${s.description}" produced no output`);
        const lines = i.steps.map((s) => `- ${s.description}: ${s.state}${s.automatic ? " (automatic)" : s.approvedBy ? ` (approved by ${s.approvedBy})` : ""}${s.output ? ` — ${s.output.split("\n")[0].slice(0, 120)}` : ""}`);
        i.report = bounded([
            `${i.name} for ${i.projectId}`,
            `Trigger: ${i.trigger.source} — ${i.trigger.summary}`,
            ...lines,
            reportStep?.output ? `\n${reportStep.output}` : "",
            problems.length
                ? `\nValidation: FAILED — ${problems.join("; ")}`
                : "\nValidation: passed — every step succeeded.",
        ].join("\n"), 6000);
        this.audit("RESULT", "autonomy-engine", problems.length
            ? `validation failed: ${problems.join("; ")}`
            : "validated and reported", { instanceId: i.instanceId, projectId: i.projectId });
        this.set(i, problems.length ? "FAILED" : "COMPLETED", problems.length ? problems.join("; ") : "completed and validated");
    }
    /* ---------------------------------- rollback ---------------------------------- */
    /**
     * Reverse completed steps, newest first, ONLY where the catalogue defines a reversal and the
     * executor can perform it. Anything else is reported as not rollbackable; nothing is promised.
     */
    async rollback(instanceId, by) {
        const i = this.get(instanceId);
        if (this.ports.emergencyStopped())
            throw new AutonomyError("forbidden", "the platform emergency stop is engaged");
        const results = [];
        for (const step of [...i.steps].reverse()) {
            if (step.state !== "SUCCEEDED")
                continue;
            const action = actionOf(step.actionId) ?? UNKNOWN_ACTION;
            if (!action.rollbackAction)
                continue;
            const inverse = actionOf(action.rollbackAction);
            const avail = this.ports.executor.available(action.rollbackAction);
            if (!inverse || !avail.ok) {
                results.push({
                    stepId: step.stepId,
                    outcome: "NOT_SUPPORTED",
                    detail: avail.ok ? "no reversal is defined" : avail.reason,
                });
                continue;
            }
            // A reversal is itself a consequential action: it runs only on the owner's command, which this call is.
            const r = await this.ports.executor
                .execute(action.rollbackAction, {
                instanceId,
                projectId: i.projectId,
                stepId: step.stepId,
                params: step.params,
                attempt: 1,
                approvedBy: by,
            })
                .catch((e) => ({
                ok: false,
                error: {
                    kind: "PERMANENT",
                    message: e instanceof Error ? e.message : "failed",
                },
            }));
            if (r.ok) {
                step.state = "ROLLED_BACK";
                results.push({
                    stepId: step.stepId,
                    outcome: "ROLLED_BACK",
                    detail: inverse.label,
                });
            }
            else
                results.push({
                    stepId: step.stepId,
                    outcome: "FAILED",
                    detail: bounded(r.error?.message ?? "failed", 200),
                });
        }
        const unsupported = i.steps.filter((s) => s.state === "SUCCEEDED" && !actionOf(s.actionId)?.rollbackAction);
        for (const s of unsupported)
            results.push({
                stepId: s.stepId,
                outcome: "NOT_SUPPORTED",
                detail: "this action cannot be rolled back",
            });
        this.instances.upsert(i);
        this.audit("RECOVERY", by, `rollback requested: ${results.filter((r) => r.outcome === "ROLLED_BACK").length} reversed, ${results.filter((r) => r.outcome !== "ROLLED_BACK").length} not reversed`, { instanceId, projectId: i.projectId, risk: "HIGH" });
        return { instance: i, results };
    }
    /* ----------------------------- Operations Center ----------------------------- */
    operations(accessible) {
        const all = this.instances.list().filter((i) => accessible(i.projectId));
        const g = this.globalState();
        const active = all.filter((i) => ["EXECUTING", "AWAITING_APPROVAL", "RECOVERING", "PAUSED"].includes(i.state));
        const queued = all.filter((i) => ["TRIGGERED", "PLANNED", "AWAITING_PLAN_APPROVAL"].includes(i.state));
        const failed = all.filter((i) => ["FAILED", "ESCALATED", "REJECTED"].includes(i.state));
        const waitingApprovals = all.flatMap((i) => i.steps
            .filter((s) => s.state === "WAITING_APPROVAL" && s.gate)
            .map((s) => ({
            instanceId: i.instanceId,
            projectId: i.projectId,
            stepId: s.stepId,
            gate: s.gate,
        })));
        const autonomousActions = all
            .flatMap((i) => i.steps
            .filter((s) => s.automatic === true && s.finishedAt)
            .map((s) => ({
            instanceId: i.instanceId,
            projectId: i.projectId,
            stepId: s.stepId,
            actionId: s.actionId,
            at: s.finishedAt,
            result: s.state,
        })))
            .sort((a, b) => b.at.localeCompare(a.at))
            .slice(0, 50);
        const blockedOperations = all.flatMap((i) => i.steps
            .filter((s) => s.state === "BLOCKED")
            .map((s) => ({
            instanceId: i.instanceId,
            projectId: i.projectId,
            stepId: s.stepId,
            reason: s.note ?? "blocked",
        })));
        const incidents = failed.map((i) => ({
            instanceId: i.instanceId,
            projectId: i.projectId,
            state: i.state,
            reason: i.stateReason,
            at: i.updatedAt,
        }));
        const recoveries = this.auditRepo
            .list()
            .filter((e) => e.kind === "RECOVERY" && (!e.projectId || accessible(e.projectId)))
            .sort((a, b) => b.at.localeCompare(a.at))
            .slice(0, 30)
            .map((e) => ({
            instanceId: e.instanceId ?? "",
            projectId: e.projectId ?? "",
            kind: (/rollback/.test(e.detail)
                ? "ROLLBACK"
                : /escalat/.test(e.detail)
                    ? "ESCALATION"
                    : "RETRY"),
            detail: e.detail,
            at: e.at,
        }));
        return {
            generatedAt: this.ports.clock(),
            global: {
                paused: g.paused,
                ...(g.reason ? { reason: g.reason } : {}),
                emergencyStop: this.ports.emergencyStopped(),
            },
            counts: {
                active: active.length,
                queued: queued.length,
                failed: failed.length,
                waitingApproval: waitingApprovals.length,
                blocked: blockedOperations.length,
                incidents: incidents.length,
                recoveries: recoveries.length,
                completed: all.filter((i) => i.state === "COMPLETED").length,
            },
            active: active.slice(0, 50),
            queued: queued.slice(0, 50),
            failed: failed.slice(0, 50),
            waitingApprovals,
            autonomousActions,
            blockedOperations,
            incidents: incidents.slice(0, 30),
            recoveries,
            orchestration: this.ports.orchestration(),
        };
    }
}
