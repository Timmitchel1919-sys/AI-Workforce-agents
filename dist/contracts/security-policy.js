import { ValidationError, requireText } from "./index.js";
export const SECURITY_RISK_LEVELS = ["low", "medium", "high", "critical"];
export function validateSecurityActionContext(context) {
    requireText(context.action, "context.action");
    requireText(context.actorId, "context.actorId");
    if (!["human", "agent", "system"].includes(context.actorType)) {
        throw new ValidationError("context.actorType must be human, agent, or system");
    }
}
