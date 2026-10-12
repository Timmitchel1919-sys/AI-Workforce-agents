import { SyncCache } from "../knowledge-memory/memory-service.js";
import { maskSecrets } from "../prompt-intelligence/secret-scan.js";
export class EmergencyError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "EmergencyError";
    }
}
export const HALT_BANNER = "AI WORKFORCE EXECUTION PAUSED";
export class EmergencyStop {
    ledger;
    clock;
    repo;
    handlers = [];
    constructor(repo, ledger, clock) {
        this.ledger = ledger;
        this.clock = clock;
        this.repo = new SyncCache(repo);
    }
    /** Called synchronously when the stop is engaged (cancel live sessions here). */
    onEngage(handler) {
        this.handlers.push(handler);
    }
    get record() {
        return (this.repo.findById("global") ?? {
            id: "global",
            state: "NORMAL",
            history: [],
        });
    }
    get state() {
        return this.record.state;
    }
    halted() {
        return this.state !== "NORMAL";
    }
    save(next) {
        this.repo.upsert(next);
        return next;
    }
    engage(by, reason) {
        if (!reason?.trim())
            throw new EmergencyError("invalid_request", "an emergency stop needs a reason");
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
                    state: "PAUSED",
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
            }
            catch {
                /* a failing handler must not undo the stop */
            }
        }
        return next;
    }
    advance(by, to, note) {
        const cur = this.record;
        const ok = (to === "INVESTIGATING" && cur.state === "PAUSED") ||
            (to === "RECOVERY_REQUIRED" &&
                (cur.state === "INVESTIGATING" || cur.state === "PAUSED"));
        if (!ok)
            throw new EmergencyError("invalid_state", `cannot move from ${cur.state} to ${to}`);
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
    resume(by, admin, note) {
        if (!admin)
            throw new EmergencyError("forbidden", "only an administrator can resume AI execution");
        const cur = this.record;
        if (cur.state !== "RECOVERY_REQUIRED")
            throw new EmergencyError("invalid_state", `resume is only possible from RECOVERY_REQUIRED (now ${cur.state})`);
        if (!note?.trim())
            throw new EmergencyError("invalid_request", "resuming needs a written note");
        const next = this.save({
            id: "global",
            state: "NORMAL",
            history: [
                ...cur.history,
                {
                    state: "RESUMED",
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
