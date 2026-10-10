/**
 * Resource locks (Layer 4).
 *
 * All-or-nothing acquisition over a SORTED key set (a global order, so two
 * tasks can never each hold what the other needs — no deadlock), and every
 * lock expires after a TTL so a crashed task cannot hold a resource forever.
 */
export interface HeldLock {
  key: string;
  owner: string;
  expiresAt: number;
}

export class ResourceLockManager {
  private readonly held = new Map<string, HeldLock>();

  /** Acquire every key or none. Returns the blocking owner on failure. */
  tryAcquire(
    keys: readonly string[],
    owner: string,
    nowMs: number,
    ttlMs: number,
  ): { ok: true } | { ok: false; key: string; owner: string } {
    this.expire(nowMs);
    const sorted = [...new Set(keys)].sort();
    for (const key of sorted) {
      const current = this.held.get(key);
      if (current && current.owner !== owner)
        return { ok: false, key, owner: current.owner };
    }
    for (const key of sorted)
      this.held.set(key, { key, owner, expiresAt: nowMs + ttlMs });
    return { ok: true };
  }

  release(owner: string): void {
    for (const [key, lock] of this.held)
      if (lock.owner === owner) this.held.delete(key);
  }

  /** Drop locks whose TTL passed (crash recovery). Returns how many. */
  expire(nowMs: number): number {
    let removed = 0;
    for (const [key, lock] of this.held) {
      if (lock.expiresAt <= nowMs) {
        this.held.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  snapshot(): HeldLock[] {
    return [...this.held.values()];
  }
}
