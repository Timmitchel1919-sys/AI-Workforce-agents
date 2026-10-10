/**
 * The V1 specialist workforce.
 *
 * These are DESCRIPTORS: static identity, capability and policy. They contain
 * no runtime state and they grant no authority. Each one states, explicitly:
 *
 *   - what it generally does            (capabilities, hierarchical)
 *   - what it is suited to               (qualification constraints)
 *   - what it may never do               (limitations, denied capabilities)
 *   - which project may employ it        (projectPolicy, deny by default)
 *   - which model policy it may use      (modelPolicy — REQUIRED)
 *   - which environments it needs        (environmentRequirements)
 *   - the highest tool ceiling it may ever receive (toolPolicy)
 *   - its risk profile and review rules  (riskProfile, reviewPolicy)
 *   - who it may hand work to            (handoffPolicy)
 *   - how its cost is attributed         (costPolicy)
 *
 * `AGENT != MODEL != TOOL != ENVIRONMENT`: nothing here pins a model name, an
 * environment instance or a tool instance. The Model Router and the Environment
 * Router choose those at execution time under governance.
 *
 * LEAST PRIVILEGE is enforced by construction here, not by convention: an agent
 * that does not need an authority simply does not declare it, and the
 * declaration is validated against the canonical capability and execution
 * capability vocabularies on load.
 */
import type { AgentDescriptor } from "../../contracts/workforce.js";
export declare const V1_SPECIALIST_WORKFORCE: readonly AgentDescriptor[];
/** Read-only lookup so callers never mutate the workforce in place. */
export declare function findV1Descriptor(agentId: string): AgentDescriptor | undefined;
