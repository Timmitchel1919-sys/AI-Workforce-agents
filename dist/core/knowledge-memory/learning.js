import { TERMINAL_RUNTIME_STATES, } from "../../contracts/execution-runtime.js";
import { clip, hashOf } from "./text.js";
import { KnowledgeError } from "./write-policy.js";
const LEARNER = { id: "execution-learner", kind: "SYSTEM" };
export function failureSignature(stage, line) {
    const normalized = line
        .replace(/^[^\s:(]+\.(?:tsx?|jsx?|css|json|mjs)\(\d+,\d+\):\s*/i, "")
        .replace(/[A-Za-z]:[\\/][^\s:]+|(?:\.{0,2}\/)?(?:[\w.-]+\/)+[\w.-]+/g, "<path>")
        .replace(/\d+/g, "#")
        .toLowerCase()
        .trim();
    return hashOf(`${stage}|${normalized}`).slice(0, 12);
}
export class ExecutionLearner {
    memory;
    retrieval;
    constructor(memory, retrieval) {
        this.memory = memory;
        this.retrieval = retrieval;
    }
    learn(input) {
        const { session, task, outcome } = input;
        const report = {
            usageUpdated: 0,
            created: [],
            candidates: [],
            skipped: [],
        };
        const projectId = task.projectId;
        // Paused or waiting executions are not finished: learn only from terminal ones.
        if (!TERMINAL_RUNTIME_STATES.includes(session.status)) {
            report.skipped.push("the execution is not finished");
            return report;
        }
        // 0. The memories the agent was handed (cited in its task prompt) are recorded as used.
        for (const id of new Set(input.context.prompt.match(/\bmem-[0-9a-f]{12}\b/g) ?? [])) {
            const used = this.memory.get(id);
            if (used && used.projectId === projectId) {
                this.retrieval.recordUsage({
                    memoryId: id,
                    projectId,
                    taskId: task.taskId,
                    agentId: input.context.agentId,
                    executionId: session.executionId,
                    reason: "cited in the task prompt",
                });
            }
        }
        // 1. Feedback: which memories were in play and how did the task end.
        report.usageUpdated = this.retrieval.recordOutcome(task.taskId, outcome.kind === "success" ? "TASK_SUCCEEDED" : "TASK_FAILED", session.executionId);
        const refs = [
            { kind: "execution", ref: session.executionId },
            { kind: "task", ref: task.taskId },
        ];
        const files = [...new Set(session.changes.map((c) => c.path))].slice(0, 12);
        // 2. A recorded, failing stage/command is a VERIFIED fact about that attempt.
        const failures = [];
        for (const v of session.validation) {
            if (v.status === "failed" && v.errors.length > 0)
                failures.push({
                    stage: v.stage,
                    line: v.errors[0],
                    ...(v.command ? { command: v.command } : {}),
                });
        }
        if (failures.length === 0) {
            for (const c of session.commands) {
                if (c.exitCode !== undefined &&
                    c.exitCode !== 0 &&
                    !c.timedOut &&
                    !c.cancelled) {
                    const line = c.output
                        .split("\n")
                        .map((l) => l.trim())
                        .find((l) => /error|fail|✖|TS\d{4}/i.test(l));
                    if (line)
                        failures.push({ stage: c.display, line, command: c.display });
                }
            }
        }
        for (const f of failures.slice(0, 2)) {
            const sig = failureSignature(f.stage, f.line);
            try {
                const res = this.memory.create({
                    type: "EXECUTION",
                    title: `Previous attempt failed (${f.stage}): ${clip(task.title, 70)}`,
                    content: `While working on "${task.title}" the ${f.stage} step failed: ${clip(f.line, 300)}${files.length ? ` Files touched: ${files.join(", ")}.` : ""}`,
                    projectId,
                    source: "EXECUTION",
                    sourceRef: `execution:${session.executionId}`,
                    tags: ["failure", f.stage.toLowerCase(), `sig-${sig}`],
                    references: refs,
                    verified: true,
                    importance: "NORMAL",
                }, LEARNER);
                report.created.push(res.memory.memoryId);
            }
            catch (error) {
                if (error instanceof KnowledgeError)
                    report.skipped.push(error.message);
                else
                    throw error;
            }
            // 3. The same failure keeps coming back → a DRAFT rule candidate (never auto-active).
            const recurring = this.memory
                .all()
                .filter((m) => m.projectId === projectId &&
                m.type === "EXECUTION" &&
                m.tags.includes(`sig-${sig}`));
            const distinctRuns = new Set(recurring.flatMap((m) => m.references.filter((r) => r.kind === "execution").map((r) => r.ref)));
            if (distinctRuns.size >= 2) {
                try {
                    const cand = this.memory.create({
                        type: "PROJECT",
                        title: `Recurring failure in ${f.stage}`,
                        content: `The ${f.stage} step has failed the same way in ${distinctRuns.size} executions: ${clip(f.line, 300)}. Consider recording a project rule or fix.`,
                        projectId,
                        source: "EXECUTION",
                        sourceRef: `pattern:${sig}`,
                        tags: ["pattern", "candidate", f.stage.toLowerCase()],
                        references: [...distinctRuns]
                            .slice(0, 5)
                            .map((ref) => ({ kind: "execution", ref })),
                        verified: false,
                    }, LEARNER);
                    report.candidates.push(cand.memory.memoryId);
                }
                catch (error) {
                    if (!(error instanceof KnowledgeError))
                        throw error;
                }
            }
        }
        // 4. A completed task whose own checks passed is a verified piece of history.
        if (outcome.kind === "success" && files.length > 0) {
            const checks = outcome.checks ?? [];
            const verified = checks.length > 0 && checks.every((c) => c.passed);
            if (verified) {
                try {
                    const res = this.memory.create({
                        type: "EXECUTION",
                        title: `Completed: ${clip(task.title, 90)}`,
                        content: `${clip(outcome.summary, 400)} Changed: ${files.join(", ")}. Checks passed: ${checks.map((c) => c.name).join(", ")}.`,
                        projectId,
                        source: "EXECUTION",
                        sourceRef: `execution:${session.executionId}`,
                        tags: [
                            "completed",
                            ...(task.type ? [task.type.toLowerCase()] : []),
                        ],
                        references: [
                            ...refs,
                            ...files
                                .slice(0, 6)
                                .map((f) => ({ kind: "file", ref: f })),
                        ],
                        verified: true,
                    }, LEARNER);
                    report.created.push(res.memory.memoryId);
                }
                catch (error) {
                    if (error instanceof KnowledgeError)
                        report.skipped.push(error.message);
                    else
                        throw error;
                }
            }
            else {
                report.skipped.push("success was not backed by passing checks, so nothing was stored");
            }
        }
        return report;
    }
}
