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
/**
 * The first authoritative production project: Money Mind, on its real
 * adapter. A Cloud Function has no Money Mind checkout, so unless
 * `MONEY_MIND_REPO_PATH` is configured the repository backend is the explicit
 * {@link UnavailableMoneyMindRepo}: the project is registered (access can be
 * granted, it appears in the graph) while every repository read or run fails
 * honestly with "repository is not available". No fixture or synthetic data
 * is ever substituted and no filesystem path is probed.
 */
export declare function createMoneyMindProductionBinding(env?: Record<string, string | undefined>): ProductionWorkforceConfiguration["projectAdapters"][number];
export declare const PRODUCTION_WORKFORCE_CONFIGURATION: ProductionWorkforceConfiguration;
/**
 * The trusted, non-secret environment *support* catalog — descriptors only.
 * These answer "what can the workforce support?", never "what is installed".
 * No real host is seeded; registered hosts/environments come exclusively from
 * live discovery (EO-2B+ probes). See EO-2A.
 */
export declare const PRODUCTION_ENVIRONMENT_DESCRIPTORS: readonly EnvironmentDescriptor[];
