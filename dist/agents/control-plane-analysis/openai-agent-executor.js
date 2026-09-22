/** Bounded, read-only production executor for Control Plane analysis tasks. */
import { DEFAULT_AGENT_LIMITS, AgentExecutionError, ProviderTimeoutError, ProviderUnavailableError, ValidationError, } from "../../contracts/index.js";
import { GeneralAgent } from "../../core/index.js";
import { OpenAIModelProvider } from "../../adapters/models/openai-model-provider.js";
export const CONTROL_PLANE_ANALYSIS_AGENT_ID = "control-plane-analysis-agent";
export const CONTROL_PLANE_ANALYSIS_TASK_TYPE = "control-plane-analysis";
export const CONTROL_PLANE_ANALYSIS_LIMITS = {
    ...DEFAULT_AGENT_LIMITS,
    maxIterations: 1,
    maxToolCalls: 0,
    maxModelCalls: 1,
    timeoutMs: 30_000,
};
const RESULT_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["summary", "findings", "risks", "recommendations", "confidence"],
    properties: {
        summary: { type: "string", minLength: 1 },
        findings: { type: "array", items: { type: "string" } },
        risks: { type: "array", items: { type: "string" } },
        recommendations: { type: "array", items: { type: "string" } },
        confidence: { type: "string", enum: ["low", "medium", "high"] },
    },
};
export class OpenAIAgentExecutor extends GeneralAgent {
    options;
    agentId = CONTROL_PLANE_ANALYSIS_AGENT_ID;
    role = "control_plane_analyst";
    limits;
    constructor(options) {
        super({ audit: options.audit, clock: options.clock });
        this.options = options;
        this.limits = {
            ...CONTROL_PLANE_ANALYSIS_LIMITS,
            ...(options.limits ?? {}),
        };
    }
    validateInput(raw) {
        if (!raw ||
            typeof raw !== "object" ||
            Array.isArray(raw) ||
            typeof raw.objective !== "string" ||
            !raw.objective.trim()) {
            throw this.fail("invalid_task", "control-plane analysis requires a non-empty objective");
        }
        const value = raw;
        return {
            objective: value.objective.trim(),
            context: stringArray(value.context),
            constraints: stringArray(value.constraints),
        };
    }
    validateOutput(output) {
        const value = output;
        if (!value ||
            typeof value.summary !== "string" ||
            !value.summary.trim() ||
            !Array.isArray(value.findings) ||
            !Array.isArray(value.risks) ||
            !Array.isArray(value.recommendations) ||
            !["low", "medium", "high"].includes(value.confidence)) {
            throw this.fail("invalid_result", "model result failed control-plane analysis validation");
        }
    }
    async run(input, task, agent, run, _guard) {
        run.checkDeadline();
        run.nextIteration("analysis");
        run.countModelCall("analysis");
        const system = "You are a read-only AI Workforce Control Plane analysis agent. Follow platform safety policy. " +
            "Do not claim to execute tools, change configuration, grant permissions, or deploy. " +
            "Return only the requested structured JSON.";
        const user = [
            `Agent role: ${agent.description}`,
            `Task objective: ${input.objective}`,
            input.context?.length
                ? `Context:\n${input.context.map((item) => `- ${item}`).join("\n")}`
                : "",
            input.constraints?.length
                ? `Constraints:\n${input.constraints.map((item) => `- ${item}`).join("\n")}`
                : "",
        ]
            .filter(Boolean)
            .join("\n\n");
        run.activity("model_call", {
            provider: this.options.provider.id,
            taskType: task.type,
        });
        try {
            const response = await this.options.provider.generateStructured({
                messages: [
                    { role: "system", content: system },
                    { role: "user", content: user },
                ],
                schemaName: "control_plane_analysis",
                schema: RESULT_SCHEMA,
                metadata: {
                    taskId: task.id,
                    agentId: this.agentId,
                    projectId: task.projectId,
                },
            });
            const parsed = parseJson(response.content);
            const result = {
                taskId: task.id,
                agentId: this.agentId,
                summary: text(parsed.summary),
                findings: stringArray(parsed.findings),
                risks: stringArray(parsed.risks),
                recommendations: stringArray(parsed.recommendations),
                confidence: confidence(parsed.confidence),
                createdAt: new Date(this.now()).toISOString(),
                metadata: {
                    provider: this.options.provider.id,
                    model: response.model,
                    ...(response.usage ? { usage: response.usage } : {}),
                    counters: run.counters,
                },
            };
            this.validateOutput(result);
            run.activity("model_result", {
                provider: this.options.provider.id,
                model: response.model,
                usage: response.usage ?? null,
            });
            return result;
        }
        catch (error) {
            if (error instanceof AgentExecutionError)
                throw error;
            if (error instanceof ValidationError) {
                throw this.fail("invalid_result", error.message, {}, error);
            }
            const reason = error instanceof ProviderTimeoutError
                ? "timeout"
                : error instanceof ProviderUnavailableError
                    ? "model_unavailable"
                    : "model_failure";
            throw this.fail(reason, `model call failed: ${error instanceof Error ? error.message : String(error)}`, {}, error);
        }
    }
}
/**
 * Trusted production binding. Provider configuration is intentionally read on
 * first execution: importing the composition declaration never reads a secret,
 * while an attempted model execution still fails closed when configuration is
 * absent.
 */
export function createProductionOpenAIAgentExecutor(audit) {
    return new OpenAIAgentExecutor({
        provider: new LazyOpenAIModelProvider(),
        audit,
    });
}
class LazyOpenAIModelProvider {
    id = "openai";
    provider;
    async generate(request) {
        return this.resolve().generate(request);
    }
    async generateStructured(request) {
        return this.resolve().generateStructured(request);
    }
    resolve() {
        if (!this.provider)
            this.provider = new OpenAIModelProvider();
        return this.provider;
    }
}
function parseJson(content) {
    try {
        const parsed = JSON.parse(content);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
            throw new Error();
        return parsed;
    }
    catch {
        throw new ValidationError("model returned invalid structured JSON");
    }
}
function text(value) {
    return typeof value === "string" ? value.trim() : "";
}
function stringArray(value) {
    return Array.isArray(value)
        ? value
            .filter((item) => typeof item === "string")
            .map((item) => item.trim())
            .filter(Boolean)
        : [];
}
function confidence(value) {
    return value === "low" || value === "medium" || value === "high"
        ? value
        : "low";
}
