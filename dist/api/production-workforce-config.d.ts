/**
 * Authoritative non-secret production capability declaration.
 *
 * Each capability is a trusted compiled binding. It contains no API key and
 * cannot load a module by name at runtime; OpenAI configuration is resolved
 * server-side only when the executor is invoked.
 */
import type { Agent, EnvironmentDescriptor } from "../contracts/index.js";
import type { ProductionWorkforceConfiguration } from "./production-workforce-bootstrap.js";
export declare const CONTROL_PLANE_ANALYSIS_AGENT: Agent;
export declare const PRODUCTION_WORKFORCE_CONFIGURATION: ProductionWorkforceConfiguration;
/**
 * The trusted, non-secret environment *support* catalog — descriptors only.
 * These answer "what can the workforce support?", never "what is installed".
 * No real host is seeded; registered hosts/environments come exclusively from
 * live discovery (EO-2B+ probes). See EO-2A.
 */
export declare const PRODUCTION_ENVIRONMENT_DESCRIPTORS: readonly EnvironmentDescriptor[];
