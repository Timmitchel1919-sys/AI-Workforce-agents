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
export declare class ResourceLockManager {
    private readonly held;
    /** Acquire every key or none. Returns the blocking owner on failure. */
    tryAcquire(keys: readonly string[], owner: string, nowMs: number, ttlMs: number): {
        ok: true;
    } | {
        ok: false;
        key: string;
        owner: string;
    };
    release(owner: string): void;
    /** Drop locks whose TTL passed (crash recovery). Returns how many. */
    expire(nowMs: number): number;
    snapshot(): HeldLock[];
}
