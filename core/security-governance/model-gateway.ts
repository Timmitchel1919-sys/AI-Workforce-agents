/**
 * Model gateway — the governed path to any model provider.
 *
 * Before a prompt leaves for a provider: the emergency stop, the calling
 * agent's trust, secrets in the text (blocked), the data classification of
 * what is being sent versus the model's maximum (blocked), and the model's own
 * status/approved task types. After the response: secrets in the output are
 * redacted and alerted. Deterministic; no model is asked to authorize a model.
 */
import type {
  ModelProvider,
  ModelRequest,
  ModelResponse,
} from "../../contracts/index.js";
import type { DataClass } from "../../contracts/security-governance.js";
import { containsSecret } from "../prompt-intelligence/secret-scan.js";
import type { SecurityAlertService } from "./alerts.js";
import type { EmergencyStop } from "./emergency.js";
import type { GovernanceLedger } from "./ledger.js";
import type { SecretGuard } from "./monitoring.js";
import { describeResource, maxDataClass } from "./resources.js";
import type { TrustRegistry } from "./trust-registry.js";

export class ModelBlockedError extends Error {
  constructor(
    message: string,
    readonly gate: "emergency" | "agent" | "secret" | "data" | "model",
  ) {
    super(message);
    this.name = "ModelBlockedError";
  }
}

/** The data class of a prompt: SECRET if it carries a credential, else the strictest file shown in it. */
export function classifyPrompt(text: string): DataClass {
  if (containsSecret(text)) return "SECRET";
  let cls: DataClass = "INTERNAL";
  for (const m of text.matchAll(/\b(?:path|file)="([^"\n]{1,300})"/g))
    cls = maxDataClass(cls, describeResource(m[1]!).dataClass);
  return cls;
}

export interface ModelGatewayDeps {
  trust: TrustRegistry;
  emergency: EmergencyStop;
  alerts: SecurityAlertService;
  ledger: GovernanceLedger;
  secrets: SecretGuard;
  isKnownAgent?: (agentId: string) => boolean;
}

export class ModelGateway {
  blocked = 0;
  constructor(private readonly d: ModelGatewayDeps) {}

  /** Throws `ModelBlockedError` when the call must not happen. */
  authorize(input: {
    provider: string;
    model: string;
    text: string;
    projectId?: string;
    taskId?: string;
    agentId?: string;
    taskType?: string;
    dataClass?: DataClass;
  }): void {
    const fail = (gate: ModelBlockedError["gate"], message: string): never => {
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
      fail(
        "emergency",
        "AI WORKFORCE EXECUTION PAUSED — model calls are blocked",
      );
    if (input.agentId && this.d.trust.isBlocked(input.agentId))
      fail(
        "agent",
        `agent ${input.agentId} is ${this.d.trust.agentState(input.agentId)}`,
      );
    const cls = maxDataClass(
      input.dataClass ?? "INTERNAL",
      classifyPrompt(input.text),
    );
    if (cls === "SECRET") {
      this.d.alerts.raise({
        severity: "HIGH",
        source: "SECRET_GUARD",
        event: "secret_in_model_request",
        description:
          "A request to a model provider contained a credential and was blocked before it was sent.",
        projectId: input.projectId,
        agentId: input.agentId,
        taskId: input.taskId,
        evidence: { provider: input.provider, model: input.model },
        dedupeKey: `model-secret:${input.agentId ?? ""}:${input.taskId ?? ""}`,
      });
      fail(
        "secret",
        "the request contains a credential; it was not sent to the model provider",
      );
    }
    const m = this.d.trust.modelAllows(
      input.provider,
      input.model,
      input.taskType,
      cls,
    );
    if (!m.ok) fail(m.reason.includes("exceeds") ? "data" : "model", m.reason);
  }
}

/** Wraps any ModelProvider with the gateway checks and output redaction. */
export class GovernedModelProvider implements ModelProvider {
  constructor(
    private readonly inner: ModelProvider,
    private readonly gateway: ModelGateway,
    private readonly secrets: SecretGuard,
  ) {}

  get id(): string {
    return this.inner.id;
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const meta = (request.metadata ?? {}) as Record<string, unknown>;
    const str = (v: unknown): string | undefined =>
      typeof v === "string" && v !== "" ? v : undefined;
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
      ...(str(meta["taskType"]) ? { taskType: str(meta["taskType"])! } : {}),
    });
    const response = await this.inner.generate(request);
    const screened = this.secrets.screen(response.content ?? "", {
      where: "model output",
      ...ctx,
    });
    return screened.found ? { ...response, content: screened.text } : response;
  }
}
