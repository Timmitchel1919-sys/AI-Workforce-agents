/**
 * Governance ledger — an append-only, hash-chained record of governance events.
 *
 * Every entry carries the hash of the previous one, so removing or editing any
 * record is detectable (`verify`). The repository wrapper refuses overwrite and
 * delete; there is no API anywhere (and none for agents) that edits history.
 * Entries are mirrored into the platform AuditLog as `governance_event` so the
 * existing audit views see them too. Details are masked and bounded.
 */
import { createHash } from "node:crypto";
import type { AuditLog } from "../audit/audit-log.js";
import type { Repository } from "../../contracts/persistence.js";
import type {
  AlertSeverity,
  LedgerEntry,
} from "../../contracts/security-governance.js";
import { SyncCache } from "../knowledge-memory/memory-service.js";
import { maskSecrets } from "../prompt-intelligence/secret-scan.js";

export class LedgerTamperError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerTamperError";
  }
}

/** Repository that only ever appends. */
export class AppendOnlyRepository<
  T extends { id: string },
> implements Repository<T> {
  private readonly inner: SyncCache<T>;
  constructor(repo: Repository<T>) {
    this.inner = new SyncCache(repo);
  }
  upsert(entity: T): void {
    if (this.inner.findById(entity.id))
      throw new LedgerTamperError("ledger entries are immutable");
    this.inner.upsert(entity);
  }
  findById(id: string): T | undefined {
    return this.inner.findById(id);
  }
  list(): T[] {
    return this.inner.list();
  }
  delete(): boolean {
    throw new LedgerTamperError("ledger entries cannot be deleted");
  }
  clear(): void {
    throw new LedgerTamperError("the ledger cannot be cleared");
  }
}

export interface LedgerFields {
  actor: string;
  severity?: AlertSeverity;
  projectId?: string | undefined;
  agentId?: string | undefined;
  taskId?: string | undefined;
  executionId?: string | undefined;
  toolId?: string | undefined;
  action?: string | undefined;
  resource?: string | undefined;
  risk?: string | undefined;
  policyIds?: string[] | undefined;
  result: string;
  detail?: Record<string, unknown>;
}

function cleanDetail(
  detail: Record<string, unknown> | undefined,
): LedgerEntry["detail"] {
  const out: LedgerEntry["detail"] = {};
  let n = 0;
  for (const [k, v] of Object.entries(detail ?? {})) {
    if (n++ >= 20) break;
    if (typeof v === "number" || typeof v === "boolean")
      out[k.slice(0, 40)] = v;
    else if (v !== undefined && v !== null)
      out[k.slice(0, 40)] = maskSecrets(
        String(typeof v === "object" ? JSON.stringify(v) : v),
      ).slice(0, 300);
  }
  return out;
}

const GENESIS = "0".repeat(64);

function hashOf(e: Omit<LedgerEntry, "hash">): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        e.seq,
        e.at,
        e.operation,
        e.severity ?? "",
        e.actor,
        e.projectId ?? "",
        e.agentId ?? "",
        e.taskId ?? "",
        e.executionId ?? "",
        e.toolId ?? "",
        e.action ?? "",
        e.resource ?? "",
        e.risk ?? "",
        e.policyIds ?? [],
        e.result,
        e.detail,
        e.prevHash,
      ]),
    )
    .digest("hex");
}

export class GovernanceLedger {
  private readonly repo: AppendOnlyRepository<LedgerEntry>;
  private seq: number;
  private lastHash: string;

  constructor(
    repo: Repository<LedgerEntry>,
    private readonly audit: AuditLog | undefined,
    private readonly clock: () => string,
  ) {
    this.repo = new AppendOnlyRepository(repo);
    const all = this.sorted();
    this.seq = all.at(-1)?.seq ?? 0;
    this.lastHash = all.at(-1)?.hash ?? GENESIS;
  }

  private sorted(): LedgerEntry[] {
    return this.repo.list().sort((a, b) => a.seq - b.seq);
  }

  record(operation: string, f: LedgerFields): LedgerEntry {
    const seq = ++this.seq;
    const base: Omit<LedgerEntry, "hash"> = {
      id: `gl-${String(seq).padStart(8, "0")}`,
      seq,
      at: this.clock(),
      operation,
      ...(f.severity ? { severity: f.severity } : {}),
      actor: f.actor,
      ...(f.projectId ? { projectId: f.projectId } : {}),
      ...(f.agentId ? { agentId: f.agentId } : {}),
      ...(f.taskId ? { taskId: f.taskId } : {}),
      ...(f.executionId ? { executionId: f.executionId } : {}),
      ...(f.toolId ? { toolId: f.toolId } : {}),
      ...(f.action ? { action: f.action } : {}),
      ...(f.resource
        ? { resource: maskSecrets(f.resource).slice(0, 300) }
        : {}),
      ...(f.risk ? { risk: f.risk } : {}),
      ...(f.policyIds ? { policyIds: f.policyIds.slice(0, 12) } : {}),
      result: f.result,
      detail: cleanDetail(f.detail),
      prevHash: this.lastHash,
    };
    const entry: LedgerEntry = { ...base, hash: hashOf(base) };
    this.repo.upsert(entry);
    this.lastHash = entry.hash;
    this.audit?.record("governance_event", {
      ...(entry.projectId ? { projectId: entry.projectId } : {}),
      ...(entry.agentId ? { agentId: entry.agentId } : {}),
      ...(entry.taskId ? { taskId: entry.taskId } : {}),
      data: {
        operation,
        result: entry.result,
        ledgerSeq: seq,
        ...(entry.risk ? { risk: entry.risk } : {}),
        ...(entry.resource ? { resource: entry.resource } : {}),
      },
    });
    return entry;
  }

  all(): readonly LedgerEntry[] {
    return this.sorted();
  }

  query(filter: {
    projectId?: string;
    agentId?: string;
    taskId?: string;
    toolId?: string;
    action?: string;
    risk?: string;
    policyId?: string;
    result?: string;
    operation?: string;
    since?: string;
    until?: string;
    limit?: number;
  }): LedgerEntry[] {
    const rows = this.sorted()
      .filter((e) => !filter.projectId || e.projectId === filter.projectId)
      .filter((e) => !filter.agentId || e.agentId === filter.agentId)
      .filter((e) => !filter.taskId || e.taskId === filter.taskId)
      .filter((e) => !filter.toolId || e.toolId === filter.toolId)
      .filter((e) => !filter.action || e.action === filter.action)
      .filter((e) => !filter.risk || e.risk === filter.risk)
      .filter((e) => !filter.policyId || e.policyIds?.includes(filter.policyId))
      .filter((e) => !filter.result || e.result === filter.result)
      .filter(
        (e) =>
          !filter.operation ||
          e.operation === filter.operation ||
          e.operation.startsWith(`${filter.operation}.`),
      )
      .filter((e) => !filter.since || e.at >= filter.since)
      .filter((e) => !filter.until || e.at <= filter.until);
    return rows
      .reverse()
      .slice(0, Math.min(Math.max(filter.limit ?? 100, 1), 500));
  }

  /** Recompute the chain. `ok:false` names the first record that does not verify. */
  verify(): { ok: boolean; entries: number; brokenAt?: number } {
    let prev = GENESIS;
    let expectedSeq = 1;
    const all = this.sorted();
    for (const e of all) {
      const { hash, ...rest } = e;
      if (e.seq !== expectedSeq || e.prevHash !== prev || hashOf(rest) !== hash)
        return { ok: false, entries: all.length, brokenAt: e.seq };
      prev = hash;
      expectedSeq++;
    }
    return { ok: true, entries: all.length };
  }
}
