/**
 * EO-6.2 — durable, project-scoped model-usage ledger.
 *
 * Every entry is written only from a real provider response's own reported
 * usage (never assumed), through the DurableLedger (survives restarts,
 * visible across Control Plane instances — same primitive EO-4.8 uses for
 * release records).
 */
import { ExecutionDeniedError, operatorCan, operatorCanAccessProject, requireExecutionId, } from "../../contracts/index.js";
import { DurableLedger } from "../release/durable-ledger.js";
import { createId } from "../shared.js";
const KIND = "usage";
export class UsageLedger {
    clock;
    ledger;
    constructor(store, clock) {
        this.clock = clock;
        this.ledger = new DurableLedger(store, clock);
    }
    /**
     * Internal recording path — called only by the governed provider decorator
     * right after a real response is received, never from an operator request.
     * Not authorized against a principal for that reason.
     */
    async record(draft) {
        const projectId = requireExecutionId(draft.projectId, "projectId");
        const record = {
            usageId: createId("usage"),
            projectId,
            taskId: draft.taskId,
            agentId: draft.agentId,
            sessionId: draft.sessionId,
            provider: draft.provider,
            model: draft.model,
            inputTokens: draft.inputTokens,
            outputTokens: draft.outputTokens,
            totalTokens: draft.totalTokens,
            cost: draft.cost,
            createdAt: this.clock(),
        };
        return this.ledger.save(KIND, record.usageId, projectId, record.createdAt, record, "create");
    }
    async listByProject(principal, projectId, limit = 200) {
        const id = requireExecutionId(projectId, "projectId");
        this.authorize(principal, id);
        return this.listInternal(id, limit);
    }
    /**
     * Totals in USD over the given windows, plus how many usage events could
     * not be priced (so a caller never silently treats "unpriced" as "free").
     * `since` bounds are inclusive ISO timestamps; a window with no bound
     * (e.g. "task" scoped by taskId, not time) is filtered by predicate instead.
     */
    async totals(principal, projectId, windows) {
        const id = requireExecutionId(projectId, "projectId");
        this.authorize(principal, id);
        return this.totalsInternal(id, windows);
    }
    /**
     * No principal: the trusted internal gate a model call runs through before
     * it is made is not an operator viewing a project, so it never needs (or
     * fabricates) an operator identity to read the usage it enforces against.
     */
    async listInternal(projectId, limit = 200) {
        const id = requireExecutionId(projectId, "projectId");
        return this.ledger.list(KIND, id, limit, (r) => r.usageId);
    }
    async totalsInternal(projectId, windows) {
        const records = await this.listInternal(projectId, 500);
        let daily = 0;
        let monthly = 0;
        let task = 0;
        let uncosted = 0;
        for (const r of records) {
            const amount = r.cost.priced ? r.cost.amountUsd : 0;
            // Only usage inside the widest window in play (monthly, or this task) can affect what is
            // reported now; older unpriced usage is irrelevant to a current evaluation.
            const inScope = r.createdAt >= windows.monthlySinceIso || (windows.taskId !== undefined && r.taskId === windows.taskId);
            if (!r.cost.priced && inScope)
                uncosted += 1;
            if (r.createdAt >= windows.dailySinceIso)
                daily += amount;
            if (r.createdAt >= windows.monthlySinceIso)
                monthly += amount;
            if (windows.taskId && r.taskId === windows.taskId)
                task += amount;
        }
        return { daily, monthly, task, uncosted };
    }
    authorize(principal, projectId) {
        if (!operatorCan(principal, "view") || !operatorCanAccessProject(principal, projectId)) {
            throw new ExecutionDeniedError("AUTHORIZATION_DENIED", "not authorized to view this project's usage");
        }
    }
}
