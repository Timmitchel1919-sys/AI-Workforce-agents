import { ValidationError, } from "../../contracts/index.js";
export class ProjectWorkforcePlanner {
    assignments;
    descriptors;
    constructor(assignments, descriptors) {
        this.assignments = assignments;
        this.descriptors = descriptors;
    }
    plan(input) {
        const groupOf = input.concurrencyGroupOf ?? (() => "default");
        const pool = this.descriptors();
        // `${group}:${agentId}` -> the task that agent is currently bound to.
        const booked = new Map();
        const used = new Set();
        const plans = [];
        for (const { taskId, requirements } of input.tasks) {
            // A task is never quietly RE-PLANNED into another project. A requirement
            // that names a different project is a caller error, and silently
            // rewriting it would staff work in a project the task was never filed
            // under.
            if (requirements.projectId !== input.projectId) {
                throw new ValidationError(`task ${taskId} requires project ${requirements.projectId} but was planned for ${input.projectId}`);
            }
            const effective = requirements;
            const group = groupOf(taskId);
            const busyAgents = [...booked.keys()]
                .filter((key) => key.startsWith(`${group}:`))
                .map((key) => key.slice(group.length + 1));
            const free = pool.filter((d) => !busyAgents.includes(d.id));
            if (input.dryRun) {
                const preview = this.assignments.qualify(effective, free, {
                    isEnabled: input.isEnabled,
                });
                if (preview.candidates.length > 0) {
                    const chosen = preview.candidates[0];
                    booked.set(`${group}:${chosen.id}`, taskId);
                    used.add(chosen.id);
                    plans.push({
                        taskId,
                        requirements: effective,
                        status: "assigned",
                        evidence: preview.evidence,
                    });
                }
                else {
                    plans.push(this.blocked(taskId, effective, preview.evidence, pool, input.projectId));
                }
                continue;
            }
            const outcome = this.assignments.assign(effective, {
                taskId,
                assignedBy: input.assignedBy ?? "planner:project-workforce",
                isEnabled: input.isEnabled,
                // Agents already bound in this concurrency group are excluded, so the
                // planner can never double-book one specialist onto two live tasks.
                excludeAgentIds: busyAgents,
            });
            if (outcome.status === "assigned") {
                booked.set(`${group}:${outcome.assignment.agentId}`, taskId);
                used.add(outcome.assignment.agentId);
                plans.push({
                    taskId,
                    requirements: effective,
                    status: "assigned",
                    assignment: outcome.assignment,
                    evidence: [this.evidenceFor(effective, outcome.assignment.agentId, pool)],
                });
                continue;
            }
            plans.push(this.blocked(taskId, effective, outcome.evidence, pool, input.projectId));
        }
        return summarise(input.projectId, plans, pool, used);
    }
    blocked(taskId, requirements, evidence, pool, projectId) {
        // Distinguish "nobody covers this" from "everyone qualified is busy": the
        // two need different responses — a new specialist versus more time.
        const stillQualifiedSomewhere = this.assignments
            .qualify(requirements, pool)
            .candidates.length > 0;
        return {
            taskId,
            requirements,
            status: stillQualifiedSomewhere ? "awaiting_capacity" : "no_qualified_agent",
            evidence,
            reason: stillQualifiedSomewhere
                ? "every qualified specialist is already bound to a concurrent task in this wave"
                : `no registered specialist covers [${requirements.requiredCapabilities.join(", ")}] for project ${projectId}`,
        };
    }
    evidenceFor(requirements, agentId, pool) {
        const outcome = this.assignments.qualify(requirements, pool);
        return (outcome.evidence.find((e) => e.agentId === agentId) ?? {
            agentId,
            qualifies: true,
            matchedCapabilities: [...requirements.requiredCapabilities],
            missingCapabilities: [],
            reasonCodes: [],
        });
    }
}
function summarise(projectId, tasks, pool, used) {
    const eligible = pool.filter((d) => d.projectPolicy.projects.includes(projectId));
    const blocked = tasks.filter((t) => t.status !== "assigned");
    const status = blocked.length === 0
        ? "fully_staffed"
        : used.size === 0
            ? "unstaffable"
            : "partially_staffed";
    const summary = status === "fully_staffed"
        ? `${tasks.length} of ${tasks.length} task(s) staffed by ${used.size} specialist(s) in project ${projectId}.`
        : status === "unstaffable"
            ? `No task in project ${projectId} can be staffed: ${eligible.length} specialist(s) are registered for this project and none qualifies for the stated requirements.`
            : `${tasks.length - blocked.length} of ${tasks.length} task(s) staffed; ${blocked.length} blocked.`;
    return Object.freeze({
        projectId,
        status,
        tasks: Object.freeze(tasks),
        usedAgentIds: Object.freeze([...used].sort()),
        eligibleAgentIds: Object.freeze(eligible.map((d) => d.id).sort()),
        blockedTaskIds: Object.freeze(blocked.map((t) => t.taskId)),
        summary,
    });
}
