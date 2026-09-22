/**
 * Declarative Money Mind project profile: which agents may use which
 * capabilities, and the least-privilege `PermissionSystem` grants that make
 * it so. No agent behaviour here — this is metadata `money-mind-tools.ts`,
 * the wiring layer, and documentation all read from one place.
 */
import { type PermissionAction, type PermissionGrant, type MoneyMindCapability } from "../../../contracts/index.js";
/**
 * Well-known default agent ids this profile grants access to. Each must match
 * the corresponding agent definition's own exported `*_AGENT_ID` constant.
 * Kept as plain strings (not imported from `agents/`) so this package
 * depends only on `contracts/`, per the adapters -> contracts dependency
 * rule.
 */
export declare const MONEY_MIND_DEFAULT_AGENT_IDS: {
    readonly research: "research-agent";
    readonly projectManager: "project-manager-agent";
    readonly developer: "developer-agent";
    readonly qa: "qa-agent";
};
export interface MoneyMindProjectProfile {
    projectId: string;
    displayName: string;
    repository: string;
    allowedCapabilitiesByAgent: Record<string, readonly MoneyMindCapability[]>;
    metadata: Record<string, unknown>;
}
/**
 * Capability-based access per §11 of the Phase 6 brief:
 *   Research:        inspect, read documentation, read status
 *   Developer:        inspect, read (file + configuration + prior test results), test
 *   QA:               inspect, read (file + configuration + prior test results), test
 *   Project Manager:  status, project/task metadata
 * No agent is granted any write, branch, commit, pull-request, or deploy
 * capability — those do not exist in code this phase (see
 * `MONEY_MIND_FUTURE_CAPABILITIES`).
 */
export declare const MONEY_MIND_PROFILE: MoneyMindProjectProfile;
/** Every agent id in the profile that is granted `capability`. */
export declare function agentsForMoneyMindCapability(capability: MoneyMindCapability): string[];
/**
 * The one required-permission action per capability — single source of truth
 * shared by the tool definitions (`money-mind-tools.ts`) and the grants
 * below, so they can never drift apart. Every capability is a `read`, except
 * `RUN_TESTS` (spawns a process: `execute`) and `READ_DOCUMENTATION`, which
 * is deliberately `execute` too: it is wired as the Research Agent's
 * `searchToolId`, and `ResearchAgent.search()` always requests the action
 * `"execute"` (the same convention `research.search` already uses).
 */
export declare const MONEY_MIND_CAPABILITY_ACTIONS: Record<MoneyMindCapability, PermissionAction>;
/**
 * Least-privilege grants for one agent's Money Mind access: exactly the
 * `PermissionAction`s its granted capabilities require (via
 * `MONEY_MIND_CAPABILITY_ACTIONS`), project-scoped. Each tool further narrows
 * eligibility via its own `allowedAgents` (defense in depth — a broad
 * project-scoped `execute` grant does not make an agent eligible for a tool
 * it is not individually listed on). Every agent is explicitly denied
 * write / deploy / external_communication / secret_access on this project,
 * regardless of its read/execute grants — deny-by-default is never implicit
 * here.
 */
export declare function moneyMindGrants(agentId: string): PermissionGrant[];
/** Grants for every agent named in the profile — convenience for wiring. */
export declare function allMoneyMindGrants(): PermissionGrant[];
