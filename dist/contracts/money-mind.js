/**
 * Money Mind project integration contracts.
 *
 * Money Mind (github.com/Timmitchel1919-sys/Money-Mind) is an independent
 * project. This module declares ONLY the controlled, structured boundary the
 * Workforce may use to interact with it — a fixed capability enum, one
 * request/response shape per capability, and pure validators. No Money Mind
 * source, dependency, or business logic is imported here or anywhere in this
 * repository; a concrete adapter under `adapters/projects/money-mind/` is the
 * only place that reaches an actual (or fixture) Money Mind checkout, and it
 * does so only through the narrow `MoneyMindRepoPort` it defines.
 */
import { requireText, ValidationError } from "./index.js";
export const MONEY_MIND_PROJECT_ID = "money-mind";
/**
 * Capabilities implemented in this phase. All are read-only except
 * `RUN_TESTS`, which executes one allowlisted, non-destructive npm script and
 * never modifies tracked source.
 *
 * `READ_FILE` is not in the phase brief's example list but is required by its
 * own File Access section (path containment, traversal rejection, denylisted
 * paths) — the same contract every other capability's file access reuses.
 */
export const MONEY_MIND_CAPABILITIES = [
    "READ_PROJECT",
    "READ_STATUS",
    "READ_TEST_RESULTS",
    "READ_CONFIGURATION",
    "READ_FILE",
    "RUN_TESTS",
    "INSPECT_STRUCTURE",
    "READ_DOCUMENTATION",
];
/**
 * Documented, NOT implemented this phase. No code path, tool, or permission
 * grant exists for any of these — they exist here only so a future phase's
 * write workflow has a stable name to target. Never enable by default.
 */
export const MONEY_MIND_FUTURE_CAPABILITIES = [
    "CREATE_FILE",
    "MODIFY_FILE",
    "CREATE_BRANCH",
    "CREATE_COMMIT",
    "CREATE_PULL_REQUEST",
    "DEPLOY",
];
/**
 * The only commands `RUN_TESTS` may ever invoke (as `npm run <script>`), and
 * only when the target repository's own `package.json` actually declares that
 * script. The model never supplies a raw command string — only this closed
 * enum reaches the execution boundary.
 */
export const MONEY_MIND_ALLOWED_SCRIPTS = [
    "build",
    "lint",
    "test",
    "typecheck",
];
export function isMoneyMindScript(value) {
    return (typeof value === "string" &&
        MONEY_MIND_ALLOWED_SCRIPTS.includes(value));
}
/* ------------------------------------------------------------------ */
/* Validators                                                         */
/* ------------------------------------------------------------------ */
export function validateMoneyMindReadFileInput(input) {
    if (!input || typeof input !== "object") {
        throw new ValidationError("money-mind read-file input must be an object");
    }
    const path = requireText(input.path, "money-mind read-file input.path");
    return { path };
}
export function validateMoneyMindRunTestsInput(input) {
    if (!input || typeof input !== "object") {
        throw new ValidationError("money-mind test input must be an object");
    }
    const script = input.script;
    if (!isMoneyMindScript(script)) {
        throw new ValidationError(`money-mind test input.script must be one of: ${MONEY_MIND_ALLOWED_SCRIPTS.join(", ")}`);
    }
    return { script };
}
export function validateMoneyMindInspectStructureInput(input) {
    if (input === undefined || input === null)
        return {};
    if (typeof input !== "object") {
        throw new ValidationError("money-mind inspect input must be an object");
    }
    const path = input.path;
    const maxDepth = input.maxDepth;
    if (path !== undefined && typeof path !== "string") {
        throw new ValidationError("money-mind inspect input.path must be a string");
    }
    if (maxDepth !== undefined &&
        (!Number.isInteger(maxDepth) || maxDepth <= 0)) {
        throw new ValidationError("money-mind inspect input.maxDepth must be a positive integer");
    }
    return {
        path: path,
        maxDepth: maxDepth,
    };
}
export function validateMoneyMindReadDocumentationInput(input) {
    if (input === undefined || input === null)
        return {};
    if (typeof input !== "object") {
        throw new ValidationError("money-mind read-docs input must be an object");
    }
    const query = input.query;
    if (query !== undefined && typeof query !== "string") {
        throw new ValidationError("money-mind read-docs input.query must be a string");
    }
    return { query: query };
}
