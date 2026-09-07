/**
 * The Money Mind tool boundary. Agents never call `MoneyMindProjectAdapter`
 * directly — every capability is exposed as a named `Tool` that goes through
 * the `ToolExecutionEngine` (validate -> resolve -> eligibility -> limits ->
 * permission -> approval -> execute -> audit), exactly like the Research
 * Agent's search/fetch tools. Each tool is scoped to the `money-mind` project
 * only (`allowedProjects: ["money-mind"]`, never the `"*"` wildcard other
 * general-purpose tools use) and to the specific agent ids the project
 * profile grants it to.
 */
import {
  type Environment,
  type Tool,
  type ToolDefinition,
  DEFAULT_TOOL_LIMITS,
  ENVIRONMENTS,
  MONEY_MIND_PROJECT_ID,
  validateMoneyMindInspectStructureInput,
  validateMoneyMindReadDocumentationInput,
  validateMoneyMindReadFileInput,
  validateMoneyMindRunTestsInput,
} from "../../../contracts/index.js";
import {
  makeInMemoryTool,
  type ToolHandlerFn,
} from "../../tools/mock-tools.js";
import type { MoneyMindProjectAdapter } from "./money-mind-project-adapter.js";
import {
  MONEY_MIND_CAPABILITY_ACTIONS,
  agentsForMoneyMindCapability,
} from "./money-mind-profile.js";

export const MONEY_MIND_TOOL_IDS = {
  readProject: "money-mind.read-project",
  status: "money-mind.status",
  readTestResults: "money-mind.read-test-results",
  readConfig: "money-mind.read-config",
  readFile: "money-mind.read-file",
  test: "money-mind.test",
  inspect: "money-mind.inspect",
  readDocs: "money-mind.read-docs",
} as const;

const ALL_ENVIRONMENTS: readonly Environment[] = [...ENVIRONMENTS];

/** `research.fetch`'s convention is `{ reference }`; the adapter's is `{ path }`. */
function normalizeReadFileInput(input: unknown): unknown {
  if (
    input &&
    typeof input === "object" &&
    !("path" in input) &&
    "reference" in input
  ) {
    return { path: (input as { reference: unknown }).reference };
  }
  return input;
}

function baseDefinition(
  id: string,
  name: string,
  description: string,
  capability: string,
): Omit<
  ToolDefinition,
  | "requiredPermission"
  | "approvalPolicy"
  | "allowedAgents"
  | "inputSchema"
  | "outputSchema"
> {
  return {
    id,
    name,
    description,
    version: "1.0.0",
    capabilities: ["money_mind", capability],
    allowedProjects: [MONEY_MIND_PROJECT_ID],
    allowedEnvironments: ALL_ENVIRONMENTS,
    timeoutMs: 20_000,
    limits: { ...DEFAULT_TOOL_LIMITS, maxCallsPerTask: 20 },
    metadata: { readOnly: capability !== "execute" },
  };
}

/** Build the eight Money Mind tools, wired to one adapter instance. */
export function makeMoneyMindTools(
  adapter: MoneyMindProjectAdapter,
): Record<keyof typeof MONEY_MIND_TOOL_IDS, Tool> {
  const call =
    (op: string): ToolHandlerFn =>
    (input) =>
      adapter.execute(op, input);

  const readProject = makeInMemoryTool(
    {
      ...baseDefinition(
        MONEY_MIND_TOOL_IDS.readProject,
        "Money Mind: Read Project",
        "Read the Money Mind project identity and profile.",
        "read",
      ),
      requiredPermission: {
        action: MONEY_MIND_CAPABILITY_ACTIONS.READ_PROJECT,
      },
      allowedAgents: agentsForMoneyMindCapability("READ_PROJECT"),
    },
    call("READ_PROJECT"),
  );

  const status = makeInMemoryTool(
    {
      ...baseDefinition(
        MONEY_MIND_TOOL_IDS.status,
        "Money Mind: Status",
        "Read structured V2 chapter status and feature-flag names.",
        "read",
      ),
      requiredPermission: { action: MONEY_MIND_CAPABILITY_ACTIONS.READ_STATUS },
      allowedAgents: agentsForMoneyMindCapability("READ_STATUS"),
    },
    call("READ_STATUS"),
  );

  const readTestResults = makeInMemoryTool(
    {
      ...baseDefinition(
        MONEY_MIND_TOOL_IDS.readTestResults,
        "Money Mind: Read Test Results",
        "Report whether an automated test suite is configured.",
        "read",
      ),
      requiredPermission: {
        action: MONEY_MIND_CAPABILITY_ACTIONS.READ_TEST_RESULTS,
      },
      allowedAgents: agentsForMoneyMindCapability("READ_TEST_RESULTS"),
    },
    call("READ_TEST_RESULTS"),
  );

  const readConfig = makeInMemoryTool(
    {
      ...baseDefinition(
        MONEY_MIND_TOOL_IDS.readConfig,
        "Money Mind: Read Configuration",
        "Read package name/version, npm scripts, and feature-flag names.",
        "read",
      ),
      requiredPermission: {
        action: MONEY_MIND_CAPABILITY_ACTIONS.READ_CONFIGURATION,
      },
      allowedAgents: agentsForMoneyMindCapability("READ_CONFIGURATION"),
    },
    call("READ_CONFIGURATION"),
  );

  const readFile = makeInMemoryTool(
    {
      ...baseDefinition(
        MONEY_MIND_TOOL_IDS.readFile,
        "Money Mind: Read File",
        "Read one text file by repository-relative path (sandboxed). Accepts " +
          "`reference` as an alias for `path` so it doubles as the Research " +
          "Agent's fetch tool.",
        "read",
      ),
      requiredPermission: { action: MONEY_MIND_CAPABILITY_ACTIONS.READ_FILE },
      allowedAgents: agentsForMoneyMindCapability("READ_FILE"),
      inputSchema: (value) => {
        validateMoneyMindReadFileInput(normalizeReadFileInput(value));
      },
    },
    (input) => adapter.execute("READ_FILE", normalizeReadFileInput(input)),
  );

  const test = makeInMemoryTool(
    {
      ...baseDefinition(
        MONEY_MIND_TOOL_IDS.test,
        "Money Mind: Run Tests",
        "Run one allowlisted, existing npm script (build/lint/test/typecheck).",
        "execute",
      ),
      requiredPermission: { action: MONEY_MIND_CAPABILITY_ACTIONS.RUN_TESTS },
      allowedAgents: agentsForMoneyMindCapability("RUN_TESTS"),
      approvalPolicy: {
        always: true,
        reason: "executes a real command against the money-mind repository",
      },
      inputSchema: (value) => {
        validateMoneyMindRunTestsInput(value);
      },
    },
    call("RUN_TESTS"),
  );

  const inspect = makeInMemoryTool(
    {
      ...baseDefinition(
        MONEY_MIND_TOOL_IDS.inspect,
        "Money Mind: Inspect Structure",
        "List the repository's directory structure (paths + type only).",
        "read",
      ),
      requiredPermission: {
        action: MONEY_MIND_CAPABILITY_ACTIONS.INSPECT_STRUCTURE,
      },
      allowedAgents: agentsForMoneyMindCapability("INSPECT_STRUCTURE"),
      inputSchema: (value) => {
        validateMoneyMindInspectStructureInput(value);
      },
    },
    call("INSPECT_STRUCTURE"),
  );

  const readDocs = makeInMemoryTool(
    {
      ...baseDefinition(
        MONEY_MIND_TOOL_IDS.readDocs,
        "Money Mind: Read Documentation",
        "Read, and optionally keyword-search, the project's documentation set.",
        "execute",
      ),
      requiredPermission: {
        action: MONEY_MIND_CAPABILITY_ACTIONS.READ_DOCUMENTATION,
      },
      allowedAgents: agentsForMoneyMindCapability("READ_DOCUMENTATION"),
      inputSchema: (value) => {
        validateMoneyMindReadDocumentationInput(value);
      },
    },
    call("READ_DOCUMENTATION"),
  );

  return {
    readProject,
    status,
    readTestResults,
    readConfig,
    readFile,
    test,
    inspect,
    readDocs,
  };
}
