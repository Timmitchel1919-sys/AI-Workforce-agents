export declare const MONEY_MIND_PROJECT_ID = "money-mind";
/**
 * Capabilities implemented in this phase. All are read-only except
 * `RUN_TESTS`, which executes one allowlisted, non-destructive npm script and
 * never modifies tracked source.
 *
 * `READ_FILE` is not in the phase brief's example list but is required by its
 * own File Access section (path containment, traversal rejection, denylisted
 * paths) — the same contract every other capability's file access reuses.
 */
export declare const MONEY_MIND_CAPABILITIES: readonly ["READ_PROJECT", "READ_STATUS", "READ_TEST_RESULTS", "READ_CONFIGURATION", "READ_FILE", "RUN_TESTS", "INSPECT_STRUCTURE", "READ_DOCUMENTATION"];
export type MoneyMindCapability = (typeof MONEY_MIND_CAPABILITIES)[number];
/**
 * Documented, NOT implemented this phase. No code path, tool, or permission
 * grant exists for any of these — they exist here only so a future phase's
 * write workflow has a stable name to target. Never enable by default.
 */
export declare const MONEY_MIND_FUTURE_CAPABILITIES: readonly ["CREATE_FILE", "MODIFY_FILE", "CREATE_BRANCH", "CREATE_COMMIT", "CREATE_PULL_REQUEST", "DEPLOY"];
export type MoneyMindFutureCapability = (typeof MONEY_MIND_FUTURE_CAPABILITIES)[number];
/**
 * The only commands `RUN_TESTS` may ever invoke (as `npm run <script>`), and
 * only when the target repository's own `package.json` actually declares that
 * script. The model never supplies a raw command string — only this closed
 * enum reaches the execution boundary.
 */
export declare const MONEY_MIND_ALLOWED_SCRIPTS: readonly ["build", "lint", "test", "typecheck"];
export type MoneyMindScript = (typeof MONEY_MIND_ALLOWED_SCRIPTS)[number];
export declare function isMoneyMindScript(value: unknown): value is MoneyMindScript;
export interface MoneyMindReadProjectOutput {
    projectId: string;
    name: string;
    description: string;
    repository: string;
    packageName?: string;
    packageVersion?: string;
    metadata: Record<string, unknown>;
}
export interface MoneyMindChapterStatus {
    number: number;
    title: string;
    implementationStatus: string;
    validationStatus: string;
}
export interface MoneyMindReadStatusOutput {
    chapters: MoneyMindChapterStatus[];
    featureFlags: readonly string[];
    summary: string;
}
export interface MoneyMindReadTestResultsOutput {
    testsConfigured: boolean;
    message: string;
}
export interface MoneyMindReadConfigurationOutput {
    packageName?: string;
    packageVersion?: string;
    scripts: Record<string, string>;
    featureFlags: readonly string[];
}
export interface MoneyMindReadFileInput {
    path: string;
}
export interface MoneyMindReadFileOutput {
    path: string;
    content: string;
    bytes: number;
    truncated: boolean;
}
export interface MoneyMindRunTestsInput {
    script: MoneyMindScript;
}
export interface MoneyMindRunTestsOutput {
    script: MoneyMindScript;
    available: boolean;
    message: string;
    exitCode?: number;
    stdout?: string;
    stderr?: string;
    timedOut?: boolean;
    durationMs?: number;
}
export interface MoneyMindInspectStructureInput {
    path?: string;
    maxDepth?: number;
}
export interface MoneyMindStructureEntry {
    path: string;
    type: "file" | "dir";
}
export interface MoneyMindInspectStructureOutput {
    root: string;
    entries: MoneyMindStructureEntry[];
    truncated: boolean;
}
export interface MoneyMindReadDocumentationInput {
    query?: string;
}
export interface MoneyMindDocumentationHit {
    title: string;
    reference: string;
    snippet: string;
    sourceType: "document";
}
export interface MoneyMindReadDocumentationOutput {
    results: MoneyMindDocumentationHit[];
}
export declare function validateMoneyMindReadFileInput(input: unknown): MoneyMindReadFileInput;
export declare function validateMoneyMindRunTestsInput(input: unknown): MoneyMindRunTestsInput;
export declare function validateMoneyMindInspectStructureInput(input: unknown): MoneyMindInspectStructureInput;
export declare function validateMoneyMindReadDocumentationInput(input: unknown): MoneyMindReadDocumentationInput;
