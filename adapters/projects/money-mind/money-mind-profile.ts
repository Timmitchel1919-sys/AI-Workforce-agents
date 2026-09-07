/**
 * Declarative Money Mind project profile: which agents may use which
 * capabilities, and the least-privilege `PermissionSystem` grants that make
 * it so. No agent behaviour here — this is metadata `money-mind-tools.ts`,
 * the wiring layer, and documentation all read from one place.
 */
import {
  type PermissionAction,
  type PermissionGrant,
  MONEY_MIND_PROJECT_ID,
  type MoneyMindCapability,
} from "../../../contracts/index.js";

/**
 * Well-known default agent ids this profile grants access to. Each must match
 * the corresponding agent definition's own exported `*_AGENT_ID` constant.
 * Kept as plain strings (not imported from `agents/`) so this package
 * depends only on `contracts/`, per the adapters -> contracts dependency
 * rule.
 */
export const MONEY_MIND_DEFAULT_AGENT_IDS = {
  research: "research-agent",
  projectManager: "project-manager-agent",
  developer: "developer-agent",
  qa: "qa-agent",
} as const;

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
export const MONEY_MIND_PROFILE: MoneyMindProjectProfile = {
  projectId: MONEY_MIND_PROJECT_ID,
  displayName: "Money Mind",
  repository: "https://github.com/Timmitchel1919-sys/Money-Mind.git",
  allowedCapabilitiesByAgent: {
    [MONEY_MIND_DEFAULT_AGENT_IDS.research]: [
      "INSPECT_STRUCTURE",
      "READ_DOCUMENTATION",
      "READ_STATUS",
      // Research's fixed pipeline always fetches by reference after a
      // search hit — `money-mind.read-file` doubles as its fetchToolId.
      "READ_FILE",
    ],
    [MONEY_MIND_DEFAULT_AGENT_IDS.projectManager]: [
      "READ_STATUS",
      "READ_PROJECT",
    ],
    [MONEY_MIND_DEFAULT_AGENT_IDS.developer]: [
      "INSPECT_STRUCTURE",
      "READ_FILE",
      "READ_CONFIGURATION",
      "READ_TEST_RESULTS",
      "RUN_TESTS",
    ],
    [MONEY_MIND_DEFAULT_AGENT_IDS.qa]: [
      "INSPECT_STRUCTURE",
      "READ_FILE",
      "READ_CONFIGURATION",
      "READ_TEST_RESULTS",
      "RUN_TESTS",
    ],
  },
  metadata: {
    integration: "adapter-only",
    readOnlyFirst: true,
    futureCapabilities: [
      "CREATE_FILE",
      "MODIFY_FILE",
      "CREATE_BRANCH",
      "CREATE_COMMIT",
      "CREATE_PULL_REQUEST",
      "DEPLOY",
    ],
  },
};

/** Every agent id in the profile that is granted `capability`. */
export function agentsForMoneyMindCapability(
  capability: MoneyMindCapability,
): string[] {
  return Object.entries(MONEY_MIND_PROFILE.allowedCapabilitiesByAgent)
    .filter(([, capabilities]) => capabilities.includes(capability))
    .map(([agentId]) => agentId);
}

/**
 * The one required-permission action per capability — single source of truth
 * shared by the tool definitions (`money-mind-tools.ts`) and the grants
 * below, so they can never drift apart. Every capability is a `read`, except
 * `RUN_TESTS` (spawns a process: `execute`) and `READ_DOCUMENTATION`, which
 * is deliberately `execute` too: it is wired as the Research Agent's
 * `searchToolId`, and `ResearchAgent.search()` always requests the action
 * `"execute"` (the same convention `research.search` already uses).
 */
export const MONEY_MIND_CAPABILITY_ACTIONS: Record<
  MoneyMindCapability,
  PermissionAction
> = {
  READ_PROJECT: "read",
  READ_STATUS: "read",
  READ_TEST_RESULTS: "read",
  READ_CONFIGURATION: "read",
  READ_FILE: "read",
  RUN_TESTS: "execute",
  INSPECT_STRUCTURE: "read",
  READ_DOCUMENTATION: "execute",
};

const RISKY_ACTIONS: readonly PermissionAction[] = [
  "write",
  "deploy",
  "external_communication",
  "secret_access",
];

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
export function moneyMindGrants(agentId: string): PermissionGrant[] {
  const capabilities =
    MONEY_MIND_PROFILE.allowedCapabilitiesByAgent[agentId] ?? [];
  const actions = new Set(
    capabilities.map((capability) => MONEY_MIND_CAPABILITY_ACTIONS[capability]),
  );
  const grants: PermissionGrant[] = [];

  for (const action of actions) {
    grants.push({
      effect: "allow",
      action,
      agentId,
      projectId: MONEY_MIND_PROJECT_ID,
      reason: `${agentId} may ${action} money-mind per its capability profile`,
    });
  }
  for (const action of RISKY_ACTIONS) {
    grants.push({
      effect: "deny",
      action,
      agentId,
      projectId: MONEY_MIND_PROJECT_ID,
      reason: `money-mind is read-only for ${agentId} in this phase (${action} denied)`,
    });
  }
  return grants;
}

/** Grants for every agent named in the profile — convenience for wiring. */
export function allMoneyMindGrants(): PermissionGrant[] {
  return Object.keys(MONEY_MIND_PROFILE.allowedCapabilitiesByAgent).flatMap(
    moneyMindGrants,
  );
}
