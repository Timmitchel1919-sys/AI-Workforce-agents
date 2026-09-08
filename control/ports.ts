/**
 * Control Plane ports.
 *
 * These are the seams a later phase (Firebase, an HTTP API, real-time events)
 * plugs adapters into. Nothing here is implemented in this phase; declaring the
 * interfaces now keeps the Control Plane provider-neutral and makes the future
 * wiring explicit:
 *
 *   Control Plane → port interface → adapter → external system
 *
 * Firebase must always be replaceable — it can only ever be an adapter behind
 * one of these ports, never a direct dependency of `control/`.
 */
import {
  type AuditEventView,
  type ControlCommandResult,
  type OperatorPrincipal,
  type Repository,
  type Entity,
} from "../contracts/index.js";
import { type HealthProbe } from "./health.js";

/**
 * The persistence port. The control-plane stores already accept an injected
 * `Repository<T>`; a Firestore-backed implementation is the intended Phase 7B
 * adapter.
 *
 * NOTE: `Repository<T>` is synchronous by design (see ADR-0002). A networked
 * store needs an async revision of this interface — an ADR-gated change that is
 * explicitly out of scope for Phase 7A.
 */
export type ControlRepository<T extends Entity> = Repository<T>;

/**
 * Resolves an opaque credential (session cookie, bearer token, Firebase ID
 * token) to an `OperatorPrincipal`. The auth layer implements this; the control
 * services still trust only the resolved principal and enforce authorization
 * from it.
 */
export interface OperatorDirectory {
  resolve(credential: string): Promise<OperatorPrincipal | null>;
}

/** A control-plane change worth pushing to connected clients. */
export type ControlPlaneEvent =
  | { kind: "command_result"; result: ControlCommandResult }
  | {
      kind: "audit_appended";
      event: AuditEventView;
    }
  | { kind: "snapshot_invalidated"; reason: string; correlationId?: string };

/**
 * Fan-out seam for real-time updates. A no-op by default; a Phase 7B adapter can
 * bridge it to SSE / WebSocket / Firestore listeners. Publishing must never
 * throw into a command — implementations swallow their own failures.
 */
export interface ControlEventPublisher {
  publish(event: ControlPlaneEvent): void;
}

/** Marker port: a probe that checks an external model provider. */
export type ProviderHealthProbe = HealthProbe;

/** Marker port: a probe that checks a tool's backing service. */
export type ToolHealthProbe = HealthProbe;
