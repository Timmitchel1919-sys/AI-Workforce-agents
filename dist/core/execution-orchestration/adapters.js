export class ModelRouterAdapter {
    router;
    constructor(router) {
        this.router = router;
    }
    async select(input) {
        try {
            const decision = await this.router.routeInternal({
                projectId: input.projectId,
                agentId: input.agent.id,
                agent: input.agent,
                requestId: input.taskId,
                taskId: input.taskId,
                requirement: {
                    requiredCapabilities: input.need.requiredCapabilities,
                    routingProfile: input.need.routingProfile,
                    structuredOutput: input.need.structuredOutput,
                },
            });
            if (decision.selectedProvider) {
                return {
                    provider: decision.selectedProvider,
                    ...(decision.selectedModel ? { model: decision.selectedModel } : {}),
                    reason: input.need.rationale,
                    routingDecisionId: decision.routingDecisionId,
                };
            }
            return {
                reason: `no eligible model (${decision.reasonCodes.join(", ") || "none declared"})`,
                routingDecisionId: decision.routingDecisionId,
            };
        }
        catch {
            return { reason: "the model router could not select a model" };
        }
    }
}
export class CostGateAdapter {
    enforcer;
    usage;
    clock;
    constructor(enforcer, usage, clock = () => new Date().toISOString()) {
        this.enforcer = enforcer;
        this.usage = usage;
        this.clock = clock;
    }
    async preflight(projectId, taskId) {
        const evaluation = await this.enforcer.evaluateInternal(projectId, taskId);
        return {
            allowed: evaluation.status !== "blocked",
            status: evaluation.status,
            detail: evaluation.detail,
        };
    }
    async spent(projectId, taskId) {
        if (!this.usage)
            return undefined;
        const now = Date.parse(this.clock());
        const totals = await this.usage.totalsInternal(projectId, {
            dailySinceIso: new Date(now - 86_400_000).toISOString(),
            monthlySinceIso: new Date(now - 31 * 86_400_000).toISOString(),
            taskId,
        });
        return totals.task;
    }
}
