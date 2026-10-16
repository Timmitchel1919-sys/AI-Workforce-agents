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
import {
  PermissionDeniedError,
  ValidationError,
  type ExecutionRecordStore,
  type OperatorPrincipal,
} from "../../contracts/index.js";
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

const RECORD_ID = "security_lockdown";
const INDEX = { projectId: "_platform", kind: "security_lockdown" };
/** How recent the administrator's sign-in must be (seconds). */
export const LOCKDOWN_REAUTH_WINDOW_S = 5 * 60;

export class LockdownService {
  constructor(
    private readonly store: ExecutionRecordStore,
    private readonly audit: AuditLog,
    private readonly clock: () => number = Date.now,
  ) {}

  async status(): Promise<LockdownState> {
    return (
      (await this.store.get<LockdownState>(RECORD_ID)) ?? {
        active: false,
        revision: 0,
      }
    );
  }

  private authorize(
    principal: OperatorPrincipal,
    authTime: number | undefined,
  ): void {
    if (principal.role !== "admin") {
      throw new PermissionDeniedError(
        "only an administrator can change the emergency lockdown",
      );
    }
    const nowS = Math.floor(this.clock() / 1000);
    if (authTime === undefined || nowS - authTime > LOCKDOWN_REAUTH_WINDOW_S) {
      throw new PermissionDeniedError(
        "recent sign-in required: sign in again, then retry within 5 minutes",
      );
    }
  }

  async activate(
    principal: OperatorPrincipal,
    authTime: number | undefined,
    reason: unknown,
    correlationId?: string,
  ): Promise<LockdownState> {
    this.authorize(principal, authTime);
    if (
      typeof reason !== "string" ||
      reason.trim() === "" ||
      reason.length > 500
    ) {
      throw new ValidationError("a reason (1-500 characters) is required");
    }
    const current = await this.status();
    if (current.active) return current; // idempotent
    const next: LockdownState = {
      active: true,
      reason: reason.trim(),
      activatedAt: new Date(this.clock()).toISOString(),
      activatedBy: principal.id,
      revision: current.revision + 1,
    };
    await this.store.put(
      RECORD_ID,
      { ...INDEX, createdAt: next.activatedAt! },
      next,
    );
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

  async lift(
    principal: OperatorPrincipal,
    authTime: number | undefined,
    correlationId?: string,
  ): Promise<LockdownState> {
    this.authorize(principal, authTime);
    const current = await this.status();
    if (!current.active) return current; // idempotent
    const next: LockdownState = {
      ...current,
      active: false,
      liftedAt: new Date(this.clock()).toISOString(),
      liftedBy: principal.id,
      revision: current.revision + 1,
    };
    await this.store.put(
      RECORD_ID,
      { ...INDEX, createdAt: next.liftedAt! },
      next,
    );
    this.audit.record("access_event", {
      data: { action: "lockdown_lifted", actor: principal.id, correlationId },
    });
    return next;
  }
}
