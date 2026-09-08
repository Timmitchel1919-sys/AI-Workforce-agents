/**
 * Control Plane ports.
 *
 * The infrastructure seams an adapter plugs into. The provider-neutral port
 * interfaces (`ControlRepository`, `OperatorDirectory`, `ControlEventPublisher`,
 * `ControlPlaneEvent`) live in `contracts/control.ts` so an adapter in
 * `adapters/` can implement them without importing `control/`; they are
 * re-exported here for `control/index.ts` consumers.
 *
 *   Control Plane → port interface → adapter → external system
 *
 * Firebase must always be replaceable — it can only ever be an adapter behind
 * one of these ports, never a direct dependency of `control/`.
 */
export {
  type ControlRepository,
  type OperatorDirectory,
  type ControlPlaneEvent,
  type ControlEventPublisher,
} from "../contracts/index.js";

import { type HealthProbe } from "./health.js";

/** Marker port: a probe that checks an external model provider. */
export type ProviderHealthProbe = HealthProbe;

/** Marker port: a probe that checks a tool's backing service. */
export type ToolHealthProbe = HealthProbe;
