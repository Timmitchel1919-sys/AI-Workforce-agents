/**
 * Authoritative non-secret production capability declaration.
 *
 * Each capability is a trusted compiled binding. It contains no API key and
 * cannot load a module by name at runtime; OpenAI configuration is resolved
 * server-side only when the executor is invoked.
 */
import type { Agent } from "../contracts/index.js";
import type { ProductionWorkforceConfiguration } from "./production-workforce-bootstrap.js";
export declare const CONTROL_PLANE_ANALYSIS_AGENT: Agent;
export declare const PRODUCTION_WORKFORCE_CONFIGURATION: ProductionWorkforceConfiguration;
