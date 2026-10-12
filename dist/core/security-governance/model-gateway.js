import { containsSecret } from "../prompt-intelligence/secret-scan.js";
import { describeResource, maxDataClass } from "./resources.js";
export class ModelBlockedError extends Error {
    gate;
    constructor(message, gate) {
        super(message);
        this.gate = gate;
        this.name = "ModelBlockedError";
    }
}
/** The data class of a prompt: SECRET if it carries a credential, else the strictest file shown in it. */
export function classifyPrompt(text) {
    if (containsSecret(text))
        return "SECRET";
    let cls = "INTERNAL";
    for (const m of text.matchAll(/\b(?:path|file)="([^"\n]{1,300})"/g))
        cls = maxDataClass(cls, describeResource(m[1]).dataClass);
    return cls;
}
export class ModelGateway {
    d;
    blocked = 0;
    constructor(d) {
        this.d = d;
    }
    /** Throws `ModelBlockedError` when the call must not happen. */
    authorize(input) {
        const fail = (gate, message) => {
            this.blocked++;
            this.d.ledger.record("model.blocked", {
                actor: input.agentId ?? "system",
                severity: gate === "secret" ? "HIGH" : "MEDIUM",
                projectId: input.projectId,
                agentId: input.agentId,
                taskId: input.taskId,
                result: gate.toUpperCase(),
                detail: {
                    provider: input.provider,
                    model: input.model,
                    reason: message,
                },
            });
            throw new ModelBlockedError(message, gate);
        };
        if (this.d.emergency.halted())
            fail("emergency", "AI WORKFORCE EXECUTION PAUSED — model calls are blocked");
        if (input.agentId && this.d.trust.isBlocked(input.agentId))
            fail("agent", `agent ${input.agentId} is ${this.d.trust.agentState(input.agentId)}`);
        const cls = maxDataClass(input.dataClass ?? "INTERNAL", classifyPrompt(input.text));
        if (cls === "SECRET") {
            this.d.alerts.raise({
                severity: "HIGH",
                source: "SECRET_GUARD",
                event: "secret_in_model_request",
                description: "A request to a model provider contained a credential and was blocked before it was sent.",
                projectId: input.projectId,
                agentId: input.agentId,
                taskId: input.taskId,
                evidence: { provider: input.provider, model: input.model },
                dedupeKey: `model-secret:${input.agentId ?? ""}:${input.taskId ?? ""}`,
            });
            fail("secret", "the request contains a credential; it was not sent to the model provider");
        }
        const m = this.d.trust.modelAllows(input.provider, input.model, input.taskType, cls);
        if (!m.ok)
            fail(m.reason.includes("exceeds") ? "data" : "model", m.reason);
    }
}
/** Wraps any ModelProvider with the gateway checks and output redaction. */
export class GovernedModelProvider {
    inner;
    gateway;
    secrets;
    constructor(inner, gateway, secrets) {
        this.inner = inner;
        this.gateway = gateway;
        this.secrets = secrets;
    }
    get id() {
        return this.inner.id;
    }
    async generate(request) {
        const meta = (request.metadata ?? {});
        const str = (v) => typeof v === "string" && v !== "" ? v : undefined;
        const text = request.messages.map((m) => m.content).join("\n");
        const ctx = {
            projectId: str(meta["projectId"]),
            taskId: str(meta["taskId"]),
            agentId: str(meta["agentId"]),
        };
        this.gateway.authorize({
            provider: this.inner.id,
            model: request.model ?? "default",
            text,
            ...(ctx.projectId ? { projectId: ctx.projectId } : {}),
            ...(ctx.taskId ? { taskId: ctx.taskId } : {}),
            ...(ctx.agentId ? { agentId: ctx.agentId } : {}),
            ...(str(meta["taskType"]) ? { taskType: str(meta["taskType"]) } : {}),
        });
        const response = await this.inner.generate(request);
        const screened = this.secrets.screen(response.content ?? "", {
            where: "model output",
            ...ctx,
        });
        return screened.found ? { ...response, content: screened.text } : response;
    }
}
