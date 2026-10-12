/**
 * Emergency stop — a global, durable brake on AI execution.
 *
 *   NORMAL ──engage──▶ PAUSED ──▶ INVESTIGATING ──▶ RECOVERY_REQUIRED ──resume──▶ NORMAL
 *
 * While not NORMAL no new task, agent action, tool call or deployment is
 * allowed (the governor and the orchestrator both consult `halted()`).
 * Recovery is controlled: only an administrator can resume, only from
 * RECOVERY_REQUIRED, with a written note — never automatically. Engaging is
 * audited and calls the registered handlers (which cancel live sessions).
 */
import type { EmergencyState } from "../../contracts/security-governance.js";
import type { Repository } from "../../contracts/persistence.js";
import { SyncCache } from "../knowledge-memory/memory-service.js";
import { maskSecrets } from "../prompt-intelligence/secret-scan.js";
import type { GovernanceLedger } from "./ledger.js";

export interface EmergencyRecord {
  id: "global";
  state: EmergencyState;
  reason?: string;
  engagedBy?: string;
  engagedAt?: string;
  history: {
    state: EmergencyState | "RESUMED";
    at: string;
    by: string;
    note?: string;
  }[];
}

export class EmergencyError extends Error {
  constructor(
    readonly code: "forbidden" | "invalid_state" | "invalid_request",
    message: string,
  ) {
    super(message);
    this.name = "EmergencyError";
  }
}

export const HALT_BANNER = "AI WORKFORCE EXECUTION PAUSED";

export class EmergencyStop {
  private readonly repo: Repository<EmergencyRecord>;
  private readonly handlers: ((record: EmergencyRecord) => void)[] = [];

  constructor(
    repo: Repository<EmergencyRecord>,
    private readonly ledger: GovernanceLedger,
    private readonly clock: () => string,
  ) {
    this.repo = new SyncCache(repo);
  }

  /** Called synchronously when the stop is engaged (cancel live sessions here). */
  onEngage(handler: (record: EmergencyRecord) => void): void {
    this.handlers.push(handler);
  }

  get record(): EmergencyRecord {
    return (
      this.repo.findById("global") ?? {
        id: "global",
        state: "NORMAL",
        history: [],
      }
    );
  }

  get state(): EmergencyState {
    return this.record.state;
  }

  halted(): boolean {
    return this.state !== "NORMAL";
  }

  private save(next: EmergencyRecord): EmergencyRecord {
    this.repo.upsert(next);
    return next;
  }

  engage(by: string, reason: string): EmergencyRecord {
    if (!reason?.trim())
      throw new EmergencyError(
        "invalid_request",
        "an emergency stop needs a reason",
      );
    const cur = this.record;
    const at = this.clock();
    const next = this.save({
      id: "global",
      state: "PAUSED",
      reason: maskSecrets(reason).slice(0, 300),
      engagedBy: by,
      engagedAt: cur.state === "NORMAL" ? at : (cur.engagedAt ?? at),
      history: [
        ...cur.history,
        {
          state: "PAUSED" as const,
          at,
          by,
          note: maskSecrets(reason).slice(0, 300),
        },
      ].slice(-100),
    });
    this.ledger.record("emergency.stop", {
      actor: by,
      severity: "CRITICAL",
      result: "PAUSED",
      detail: { reason: next.reason ?? "" },
    });
    for (const h of this.handlers) {
      try {
        h(next);
      } catch {
        /* a failing handler must not undo the stop */
      }
    }
    return next;
  }

  advance(
    by: string,
    to: "INVESTIGATING" | "RECOVERY_REQUIRED",
    note?: string,
  ): EmergencyRecord {
    const cur = this.record;
    const ok =
      (to === "INVESTIGATING" && cur.state === "PAUSED") ||
      (to === "RECOVERY_REQUIRED" &&
        (cur.state === "INVESTIGATING" || cur.state === "PAUSED"));
    if (!ok)
      throw new EmergencyError(
        "invalid_state",
        `cannot move from ${cur.state} to ${to}`,
      );
    const next = this.save({
      ...cur,
      state: to,
      history: [
        ...cur.history,
        {
          state: to,
          at: this.clock(),
          by,
          ...(note ? { note: maskSecrets(note).slice(0, 300) } : {}),
        },
      ].slice(-100),
    });
    this.ledger.record("emergency.advanced", {
      actor: by,
      severity: "HIGH",
      result: to,
    });
    return next;
  }

  resume(by: string, admin: boolean, note: string): EmergencyRecord {
    if (!admin)
      throw new EmergencyError(
        "forbidden",
        "only an administrator can resume AI execution",
      );
    const cur = this.record;
    if (cur.state !== "RECOVERY_REQUIRED")
      throw new EmergencyError(
        "invalid_state",
        `resume is only possible from RECOVERY_REQUIRED (now ${cur.state})`,
      );
    if (!note?.trim())
      throw new EmergencyError(
        "invalid_request",
        "resuming needs a written note",
      );
    const next = this.save({
      id: "global",
      state: "NORMAL",
      history: [
        ...cur.history,
        {
          state: "RESUMED" as const,
          at: this.clock(),
          by,
          note: maskSecrets(note).slice(0, 300),
        },
      ].slice(-100),
    });
    this.ledger.record("emergency.resumed", {
      actor: by,
      severity: "HIGH",
      result: "NORMAL",
      detail: { note },
    });
    return next;
  }
}
