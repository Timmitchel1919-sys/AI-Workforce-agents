/**
 * UI Layer 11 — emergency lockdown.
 *
 * While active, the Control Plane refuses EVERY state-changing command (and
 * destructive-action routes). Reads keep working so the owner can investigate,
 * and "sign out all devices" keeps working because it only reduces access.
 *
 * Activation and lifting both require an ACTIVE administrator whose sign-in is
 * recent (step-up), are audited, and are idempotent. State is durable (the
 * execution record store, Firestore in production) so every instance agrees.
 * There is no unauthenticated bypass: lifting is the same governed path.
 */
import { type ExecutionRecordStore, type OperatorPrincipal } from "../../contracts/index.js";
import type { AuditLog } from "../audit/audit-log.js";
export interface LockdownState {
    active: boolean;
    reason?: string;
    activatedAt?: string;
    activatedBy?: string;
    liftedAt?: string;
    liftedBy?: string;
    /** Monotonic: bumps on every real state change. */
    revision: number;
}
/** How recent the administrator's sign-in must be (seconds). */
export declare const LOCKDOWN_REAUTH_WINDOW_S: number;
export declare class LockdownService {
    private readonly store;
    private readonly audit;
    private readonly clock;
    constructor(store: ExecutionRecordStore, audit: AuditLog, clock?: () => number);
    status(): Promise<LockdownState>;
    private authorize;
    activate(principal: OperatorPrincipal, authTime: number | undefined, reason: unknown, correlationId?: string): Promise<LockdownState>;
    lift(principal: OperatorPrincipal, authTime: number | undefined, correlationId?: string): Promise<LockdownState>;
}
