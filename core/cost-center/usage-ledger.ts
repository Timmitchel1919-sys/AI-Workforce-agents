/**
 * EO-6.2 — durable, project-scoped model-usage ledger.
 *
 * Every entry is written only from a real provider response's own reported
 * usage (never assumed), through the DurableLedger (survives restarts,
 * visible across Control Plane instances — same primitive EO-4.8 uses for
 * release records).
 */
import {
  ExecutionDeniedError,
  RecordExistsError,
  operatorCan,
  operatorCanAccessProject,
  requireExecutionId,
  sumUsd,
  type ExecutionRecordStore,
  type OperatorPrincipal,
  type UsageDraft,
  type UsageRecord,
} from "../../contracts/index.js";
import { DurableLedger } from "../release/durable-ledger.js";
import { createId } from "../shared.js";

const KIND = "usage";

export class UsageLedger {
  private readonly ledger: DurableLedger;
  /**
   * Coalesces concurrent `record()` calls for the SAME idempotency key onto
   * ONE write, within this process. This is what makes idempotency actually
   * safe under concurrency for the no-store (in-memory) composition too: the
   * store-backed path also gets `RecordExistsError` protection from
   * `DurableLedger`/Firestore, but the in-memory fallback has none of its
   * own — two truly concurrent callers there would otherwise both "win" and
   * whichever write lands last would silently overwrite the other's content
   * with no error to catch. Reserving the SAME in-flight promise, set
   * synchronously before any `await`, closes that gap without needing the
   * shared `DurableLedger` primitive itself to change.
   */
  private readonly inFlight = new Map<string, Promise<UsageRecord>>();

  constructor(
    store: ExecutionRecordStore | undefined,
    private readonly clock: () => string,
  ) {
    this.ledger = new DurableLedger(store, clock);
  }

  /**
   * Internal recording path — called only by the governed provider decorator
   * right after a real response is received, never from an operator request.
   * Not authorized against a principal for that reason.
   *
   * IDEMPOTENT when the caller supplies `idempotencyKey`: a retried call with
   * the SAME key for the SAME distinct request returns the FIRST record
   * unchanged rather than creating a second one (prevents double-charging a
   * project for one retried provider call). Safe under concurrency: the
   * store-backed path relies on create-only semantics, so two instances
   * racing on the same key can never both win — the loser re-reads and
   * returns what the winner wrote. With no key, no dedupe is possible; every
   * call records a new entry.
   *
   * A caller is expected to generate a key that is unique PER DISTINCT
   * request (like any idempotency key — reusing one across genuinely
   * different requests means only the first is ever recorded, by design, the
   * same as it would be anywhere else this pattern is used).
   *
   * The key is validated (`requireExecutionId`) and joined with `\u0000` —
   * never with `:`, which `projectId` may legally contain — so a colon in
   * one project's id can never be mistaken for the id/key boundary and
   * collide with a different project's record (e.g. project `"acme"` with
   * key `"eu:x"` must never produce the same storage id as project
   * `"acme:eu"` with key `"x"`).
   */
  async record(draft: UsageDraft): Promise<UsageRecord> {
    const projectId = requireExecutionId(draft.projectId, "projectId");
    if (!draft.idempotencyKey) return this.persist(draft, projectId, createId("usage"));

    const usageId = `idem:${projectId}\u0000${requireExecutionId(draft.idempotencyKey, "idempotencyKey")}`;
    // Reserved SYNCHRONOUSLY (no `await` above this line since entering the function) — two calls
    // for the same key, even invoked back-to-back with no store configured, coalesce onto the one
    // promise set here, instead of both reaching a write.
    const pending = this.inFlight.get(usageId);
    if (pending) return pending;
    const promise = (async () => {
      const existing = await this.ledger.find<UsageRecord>(KIND, usageId);
      return existing ?? this.persist(draft, projectId, usageId);
    })();
    this.inFlight.set(usageId, promise);
    try {
      return await promise;
    } finally {
      this.inFlight.delete(usageId);
    }
  }

  private async persist(draft: UsageDraft, projectId: string, usageId: string): Promise<UsageRecord> {
    const record: UsageRecord = {
      usageId,
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
      idempotencyKey: draft.idempotencyKey,
      createdAt: this.clock(),
    };
    try {
      return await this.ledger.save(KIND, usageId, projectId, record.createdAt, record, "create");
    } catch (error) {
      if (draft.idempotencyKey && error instanceof RecordExistsError) {
        const existing = await this.ledger.find<UsageRecord>(KIND, usageId);
        if (existing) return existing;
      }
      throw error;
    }
  }

  async listByProject(
    principal: OperatorPrincipal,
    projectId: string,
    limit = 200,
  ): Promise<UsageRecord[]> {
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
  async totals(
    principal: OperatorPrincipal,
    projectId: string,
    windows: { dailySinceIso: string; monthlySinceIso: string; taskId?: string },
  ): Promise<{ daily: number; monthly: number; task: number; uncosted: number }> {
    const id = requireExecutionId(projectId, "projectId");
    this.authorize(principal, id);
    return this.totalsInternal(id, windows);
  }

  /**
   * No principal: the trusted internal gate a model call runs through before
   * it is made is not an operator viewing a project, so it never needs (or
   * fabricates) an operator identity to read the usage it enforces against.
   */
  async listInternal(projectId: string, limit = 200): Promise<UsageRecord[]> {
    const id = requireExecutionId(projectId, "projectId");
    return this.ledger.list<UsageRecord>(KIND, id, limit, (r) => r.usageId);
  }

  async totalsInternal(
    projectId: string,
    windows: { dailySinceIso: string; monthlySinceIso: string; taskId?: string },
  ): Promise<{ daily: number; monthly: number; task: number; uncosted: number }> {
    const records = await this.listInternal(projectId, 500);
    const dailyAmounts: number[] = [];
    const monthlyAmounts: number[] = [];
    const taskAmounts: number[] = [];
    let uncosted = 0;
    for (const r of records) {
      const amount = r.cost.priced ? r.cost.amountUsd : 0;
      // Only usage inside the widest window in play (monthly, or this task) can affect what is
      // reported now; older unpriced usage is irrelevant to a current evaluation.
      const inScope =
        r.createdAt >= windows.monthlySinceIso || (windows.taskId !== undefined && r.taskId === windows.taskId);
      if (!r.cost.priced && inScope) uncosted += 1;
      if (r.createdAt >= windows.dailySinceIso) dailyAmounts.push(amount);
      if (r.createdAt >= windows.monthlySinceIso) monthlyAmounts.push(amount);
      if (windows.taskId && r.taskId === windows.taskId) taskAmounts.push(amount);
    }
    // Kahan summation: plain `+=` over many small USD amounts drifts (MONEY CORRECTNESS).
    return { daily: sumUsd(dailyAmounts), monthly: sumUsd(monthlyAmounts), task: sumUsd(taskAmounts), uncosted };
  }

  private authorize(principal: OperatorPrincipal, projectId: string): void {
    if (!operatorCan(principal, "view") || !operatorCanAccessProject(principal, projectId)) {
      throw new ExecutionDeniedError("AUTHORIZATION_DENIED", "not authorized to view this project's usage");
    }
  }
}
