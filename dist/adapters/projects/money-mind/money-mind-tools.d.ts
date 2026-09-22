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
import { type Tool } from "../../../contracts/index.js";
import type { MoneyMindProjectAdapter } from "./money-mind-project-adapter.js";
export declare const MONEY_MIND_TOOL_IDS: {
    readonly readProject: "money-mind.read-project";
    readonly status: "money-mind.status";
    readonly readTestResults: "money-mind.read-test-results";
    readonly readConfig: "money-mind.read-config";
    readonly readFile: "money-mind.read-file";
    readonly test: "money-mind.test";
    readonly inspect: "money-mind.inspect";
    readonly readDocs: "money-mind.read-docs";
};
/** Build the eight Money Mind tools, wired to one adapter instance. */
export declare function makeMoneyMindTools(adapter: MoneyMindProjectAdapter): Record<keyof typeof MONEY_MIND_TOOL_IDS, Tool>;
