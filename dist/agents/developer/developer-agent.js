/**
 * Developer Agent.
 *
 * Planning/review-oriented: one model call produces a `DeveloperResult` —
 * a plan, a list of *proposed* changes (description + rationale + risk
 * level), risks, open questions, and a recommendation. It never writes a
 * file, runs a command, or touches a repository — no such dependency is
 * injected, so none is reachable.
 */
import { DEFAULT_AGENT_LIMITS, ProviderUnavailableError, validateDeveloperResult, validateDeveloperTask, } from "../../contracts/index.js";
import { GeneralAgent } from "../../core/agents/general-agent.js";
import { extractJsonObject, toStringArray, truncate, } from "../shared/text-utils.js";
import { DEVELOPER_AGENT_ID, DEVELOPER_AGENT_LIMITS, } from "./developer-agent-definition.js";
const RECOMMENDATIONS = [
    "ready_for_qa",
    "needs_clarification",
    "blocked",
];
const RISK_LEVELS = ["low", "medium", "high"];
export class DeveloperAgent extends GeneralAgent {
    agentId = DEVELOPER_AGENT_ID;
    role = "developer";
    limits;
    model;
    logContent;
    constructor(config) {
        super({ audit: config.audit, clock: config.clock });
        this.limits = {
            ...DEFAULT_AGENT_LIMITS,
            ...DEVELOPER_AGENT_LIMITS,
            ...(config.limits ?? {}),
        };
        this.model = config.model;
        this.logContent = config.logContent ?? false;
    }
    validateInput(raw) {
        try {
            return validateDeveloperTask(raw);
        }
        catch (error) {
            throw this.fail("invalid_task", error instanceof Error ? error.message : String(error), {}, error);
        }
    }
    validateOutput(output) {
        try {
            validateDeveloperResult(output);
        }
        catch (error) {
            throw this.fail("invalid_result", error instanceof Error ? error.message : String(error), {}, error);
        }
    }
    async run(input, task, _agent, run, _guard) {
        run.checkDeadline();
        run.nextIteration(input.mode);
        const raw = await this.callModel(task, run, input);
        const parsed = extractJsonObject(raw);
        if (!parsed) {
            throw this.fail("model_failure", "developer model returned no parseable JSON");
        }
        run.activity("plan_ready", {});
        return {
            taskId: task.id,
            agentId: this.agentId,
            mode: input.mode,
            summary: typeof parsed.summary === "string" ? parsed.summary : "",
            plan: toStringArray(parsed.plan),
            proposedChanges: normalizeChanges(parsed.proposedChanges),
            risks: toStringArray(parsed.risks),
            openQuestions: toStringArray(parsed.openQuestions),
            recommendation: normalizeRecommendation(parsed.recommendation),
            createdAt: new Date(this.now()).toISOString(),
            metadata: { objective: input.objective },
        };
    }
    async callModel(task, run, input) {
        run.checkDeadline();
        run.countModelCall(input.mode);
        if (!this.model) {
            throw this.fail("model_unavailable", "no model provider configured");
        }
        const system = "You are the Developer Agent, in planning/review mode only. You never " +
            "write to a repository or run a command — you produce a plan and " +
            "*proposed* changes with rationale and a risk level (low, medium, " +
            'high). Respond with ONLY JSON: {"summary": string, "plan": ' +
            'string[], "proposedChanges": [{"description": string, "rationale": ' +
            'string, "riskLevel": "low"|"medium"|"high"}], "risks": string[], ' +
            '"openQuestions": string[], "recommendation": ' +
            '"ready_for_qa"|"needs_clarification"|"blocked"}.';
        const user = [
            `Mode: ${input.mode}`,
            `Objective: ${input.objective}`,
            `Instructions: ${input.instructions}`,
            input.context.length
                ? `Context:\n${input.context.map((c) => `- ${c}`).join("\n")}`
                : "",
            input.acceptanceCriteria.length
                ? `Acceptance criteria:\n${input.acceptanceCriteria.map((c) => `- ${c}`).join("\n")}`
                : "",
            input.constraints.length
                ? `Constraints: ${input.constraints.join("; ")}`
                : "",
        ]
            .filter(Boolean)
            .join("\n");
        run.activity("model_call", {
            mode: input.mode,
            ...(this.logContent
                ? { promptPreview: truncate(`${system}\n${user}`, 300) }
                : {}),
        });
        try {
            const response = await this.model.generate({
                messages: [
                    { role: "system", content: system },
                    { role: "user", content: user },
                ],
                metadata: {
                    taskId: task.id,
                    agentId: this.agentId,
                    projectId: task.projectId,
                },
            });
            run.activity("model_result", {
                mode: input.mode,
                model: response.model,
                chars: response.content.length,
            });
            return response.content;
        }
        catch (error) {
            const reason = error instanceof ProviderUnavailableError
                ? "model_unavailable"
                : "model_failure";
            throw this.fail(reason, `model call failed: ${error instanceof Error ? error.message : String(error)}`, {}, error);
        }
    }
}
function normalizeRecommendation(value) {
    return typeof value === "string" &&
        RECOMMENDATIONS.includes(value)
        ? value
        : "needs_clarification";
}
function normalizeChanges(value) {
    if (!Array.isArray(value))
        return [];
    return value
        .filter((c) => !!c && typeof c === "object" && !Array.isArray(c))
        .map((c) => ({
        description: typeof c.description === "string" ? c.description : "",
        rationale: typeof c.rationale === "string" ? c.rationale : "",
        riskLevel: RISK_LEVELS.includes(c.riskLevel)
            ? c.riskLevel
            : "medium",
    }))
        .filter((c) => c.description !== "" && c.rationale !== "");
}
