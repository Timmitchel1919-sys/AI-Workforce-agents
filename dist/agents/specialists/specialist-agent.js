import { DEFAULT_AGENT_LIMITS, ProviderUnavailableError, } from "../../contracts/index.js";
import { validateSpecialistResult, validateSpecialistTask, } from "../../contracts/workforce.js";
import { GeneralAgent } from "../../core/agents/general-agent.js";
import { extractJsonObject, truncate } from "../shared/text-utils.js";
export class SpecialistAgent extends GeneralAgent {
    agentId;
    role;
    limits;
    descriptor;
    model;
    logContent;
    constructor(config) {
        super({ audit: config.audit, clock: config.clock });
        this.descriptor = config.descriptor;
        this.agentId = config.descriptor.id;
        this.role = config.descriptor.role;
        this.limits = {
            ...DEFAULT_AGENT_LIMITS,
            ...(config.limits ?? {}),
        };
        this.model = config.model;
        this.logContent = config.logContent ?? false;
    }
    validateInput(raw) {
        try {
            return validateSpecialistTask(raw);
        }
        catch (error) {
            throw this.fail("invalid_task", error instanceof Error ? error.message : String(error), {}, error);
        }
    }
    validateOutput(output) {
        try {
            validateSpecialistResult(output);
        }
        catch (error) {
            throw this.fail("invalid_result", error instanceof Error ? error.message : String(error), {}, error);
        }
    }
    async run(input, task, _agent, run, _guard) {
        run.checkDeadline();
        run.nextIteration(this.role);
        const raw = await this.callModel(task, run, input);
        const parsed = extractJsonObject(raw);
        if (!parsed) {
            throw this.fail("model_failure", `${this.role} model returned no parseable JSON`);
        }
        run.activity("task_completed", {});
        return {
            taskId: task.id,
            agentId: this.agentId,
            summary: typeof parsed.summary === "string" ? parsed.summary : "Task completed",
            output: parsed,
            createdAt: new Date(this.now()).toISOString(),
        };
    }
    async callModel(task, run, input) {
        run.checkDeadline();
        run.countModelCall(this.role);
        if (!this.model) {
            throw this.fail("model_unavailable", "no model provider configured");
        }
        const system = `You are the ${this.descriptor.name} (${this.descriptor.role}) in the ${this.descriptor.department} department.\n` +
            `Description: ${this.descriptor.description}\n` +
            `Your capabilities: ${this.descriptor.capabilities.join(", ")}\n` +
            `You should provide a structured JSON response to fulfill the user's objective.\n` +
            `Respond with ONLY JSON containing at least {"summary": "Brief explanation of what you did", ...other fields relevant to the task}.`;
        const user = [
            `Objective: ${input.objective}`,
            `Instructions: ${input.instructions}`,
            input.context.length
                ? `Context:\n${input.context.map((c) => `- ${c}`).join("\n")}`
                : "",
            input.acceptanceCriteria.length
                ? `Acceptance criteria:\n${input.acceptanceCriteria.map((c) => `- ${c}`).join("\n")}`
                : "",
        ]
            .filter(Boolean)
            .join("\n");
        run.activity("model_call", {
            mode: this.role,
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
                mode: this.role,
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
