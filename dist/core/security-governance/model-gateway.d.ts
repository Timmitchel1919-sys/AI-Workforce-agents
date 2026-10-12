/**
 * Model gateway — the governed path to any model provider.
 *
 * Before a prompt leaves for a provider: the emergency stop, the calling
 * agent's trust, secrets in the text (blocked), the data classification of
 * what is being sent versus the model's maximum (blocked), and the model's own
 * status/approved task types. After the response: secrets in the output are
 * redacted and alerted. Deterministic; no model is asked to authorize a model.
 */
import type { ModelProvider, ModelRequest, ModelResponse } from "../../contracts/index.js";
import type { DataClass } from "../../contracts/security-governance.js";
import type { SecurityAlertService } from "./alerts.js";
import type { EmergencyStop } from "./emergency.js";
import type { GovernanceLedger } from "./ledger.js";
import type { SecretGuard } from "./monitoring.js";
import type { TrustRegistry } from "./trust-registry.js";
export declare class ModelBlockedError extends Error {
    readonly gate: "emergency" | "agent" | "secret" | "data" | "model";
    constructor(message: string, gate: "emergency" | "agent" | "secret" | "data" | "model");
}
/** The data class of a prompt: SECRET if it carries a credential, else the strictest file shown in it. */
export declare function classifyPrompt(text: string): DataClass;
export interface ModelGatewayDeps {
    trust: TrustRegistry;
    emergency: EmergencyStop;
    alerts: SecurityAlertService;
    ledger: GovernanceLedger;
    secrets: SecretGuard;
    isKnownAgent?: (agentId: string) => boolean;
}
export declare class ModelGateway {
    private readonly d;
    blocked: number;
    constructor(d: ModelGatewayDeps);
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
    }): void;
}
/** Wraps any ModelProvider with the gateway checks and output redaction. */
export declare class GovernedModelProvider implements ModelProvider {
    private readonly inner;
    private readonly gateway;
    private readonly secrets;
    constructor(inner: ModelProvider, gateway: ModelGateway, secrets: SecretGuard);
    get id(): string;
    generate(request: ModelRequest): Promise<ModelResponse>;
}
