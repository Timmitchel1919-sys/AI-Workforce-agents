/**
 * Authoritative non-secret production capability declaration.
 *
 * This file is intentionally empty today: no real AgentExecutor has been
 * approved and configured for production. Adding a capability requires a
 * trusted compiled binding plus an explicit declaration here; test fixtures
 * and dynamically loaded code cannot enter a production runtime.
 */
import type { ProductionWorkforceConfiguration } from "./production-workforce-bootstrap.js";

export const PRODUCTION_WORKFORCE_CONFIGURATION: ProductionWorkforceConfiguration =
  Object.freeze({
    agents: Object.freeze([]),
    executorBindings: Object.freeze({}),
    tools: Object.freeze([]),
    toolHandlerBindings: Object.freeze({}),
    projectAdapters: Object.freeze([]),
    permissionGrants: Object.freeze([]),
  });
