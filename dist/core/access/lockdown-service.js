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
import { PermissionDeniedError, ValidationError, } from "../../contracts/index.js";
const RECORD_ID = "security_lockdown";
const INDEX = { projectId: "_platform", kind: "security_lockdown" };
/** How recent the administrator's sign-in must be (seconds). */
export const LOCKDOWN_REAUTH_WINDOW_S = 5 * 60;
export class LockdownService {
    store;
    audit;
    clock;
    constructor(store, audit, clock = Date.now) {
        this.store = store;
        this.audit = audit;
        this.clock = clock;
    }
    async status() {
        return ((await this.store.get(RECORD_ID)) ?? {
            active: false,
            revision: 0,
        });
    }
    authorize(principal, authTime) {
        if (principal.role !== "admin") {
            throw new PermissionDeniedError("only an administrator can change the emergency lockdown");
        }
        const nowS = Math.floor(this.clock() / 1000);
        if (authTime === undefined || nowS - authTime > LOCKDOWN_REAUTH_WINDOW_S) {
            throw new PermissionDeniedError("recent sign-in required: sign in again, then retry within 5 minutes");
        }
    }
    async activate(principal, authTime, reason, correlationId) {
        this.authorize(principal, authTime);
        if (typeof reason !== "string" ||
            reason.trim() === "" ||
            reason.length > 500) {
            throw new ValidationError("a reason (1-500 characters) is required");
        }
        const current = await this.status();
        if (current.active)
            return current; // idempotent
        const next = {
            active: true,
            reason: reason.trim(),
            activatedAt: new Date(this.clock()).toISOString(),
            activatedBy: principal.id,
            revision: current.revision + 1,
        };
        await this.store.put(RECORD_ID, { ...INDEX, createdAt: next.activatedAt }, next);
        this.audit.record("access_event", {
            data: {
                action: "lockdown_activated",
                actor: principal.id,
                reason: next.reason,
                correlationId,
            },
        });
        return next;
    }
    async lift(principal, authTime, correlationId) {
        this.authorize(principal, authTime);
        const current = await this.status();
        if (!current.active)
            return current; // idempotent
        const next = {
            ...current,
            active: false,
            liftedAt: new Date(this.clock()).toISOString(),
            liftedBy: principal.id,
            revision: current.revision + 1,
        };
        await this.store.put(RECORD_ID, { ...INDEX, createdAt: next.liftedAt }, next);
        this.audit.record("access_event", {
            data: { action: "lockdown_lifted", actor: principal.id, correlationId },
        });
        return next;
    }
}
