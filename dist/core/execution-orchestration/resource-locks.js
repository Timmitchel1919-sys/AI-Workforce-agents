export class ResourceLockManager {
    held = new Map();
    /** Acquire every key or none. Returns the blocking owner on failure. */
    tryAcquire(keys, owner, nowMs, ttlMs) {
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
    release(owner) {
        for (const [key, lock] of this.held)
            if (lock.owner === owner)
                this.held.delete(key);
    }
    /** Drop locks whose TTL passed (crash recovery). Returns how many. */
    expire(nowMs) {
        let removed = 0;
        for (const [key, lock] of this.held) {
            if (lock.expiresAt <= nowMs) {
                this.held.delete(key);
                removed += 1;
            }
        }
        return removed;
    }
    snapshot() {
        return [...this.held.values()];
    }
}
