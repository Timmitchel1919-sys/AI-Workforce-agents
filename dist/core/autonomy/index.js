import { InMemoryRepository } from "../persistence/in-memory-repository.js";
export * from "./catalog.js";
export * from "./engine.js";
export function inMemoryAutonomyRepos() {
    const r = () => new InMemoryRepository();
    return {
        settings: r(),
        global: r(),
        definitions: r(),
        rules: r(),
        instances: r(),
        audit: r(),
    };
}
/**
 * The executor only offers the actions whose handler was actually wired. An action without a
 * handler is reported UNAVAILABLE and the workflow blocks with that reason: nothing is simulated.
 */
export class PlatformActionExecutor {
    handlers;
    reasons;
    constructor(handlers, reasons = {}) {
        this.handlers = handlers;
        this.reasons = reasons;
    }
    available(actionId) {
        return this.handlers[actionId]
            ? { ok: true, reason: "available" }
            : {
                ok: false,
                reason: this.reasons[actionId] ??
                    `"${actionId}" is not available in this deployment (no executor is wired for it)`,
            };
    }
    async execute(actionId, ctx) {
        const h = this.handlers[actionId];
        if (!h)
            return {
                ok: false,
                error: {
                    kind: "UNAVAILABLE",
                    message: this.available(actionId).reason,
                },
            };
        return h(ctx);
    }
}
