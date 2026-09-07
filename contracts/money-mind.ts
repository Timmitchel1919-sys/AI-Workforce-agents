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
] as const;
export type MoneyMindCapability = (typeof MONEY_MIND_CAPABILITIES)[number];

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
] as const;
export type MoneyMindFutureCapability =
  (typeof MONEY_MIND_FUTURE_CAPABILITIES)[number];

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
] as const;
export type MoneyMindScript = (typeof MONEY_MIND_ALLOWED_SCRIPTS)[number];

export function isMoneyMindScript(value: unknown): value is MoneyMindScript {
  return (
    typeof value === "string" &&
    (MONEY_MIND_ALLOWED_SCRIPTS as readonly string[]).includes(value)
  );
}

/* ------------------------------------------------------------------ */
/* Operation input / output shapes                                    */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* Validators                                                         */
/* ------------------------------------------------------------------ */

export function validateMoneyMindReadFileInput(
  input: unknown,
): MoneyMindReadFileInput {
  if (!input || typeof input !== "object") {
    throw new ValidationError("money-mind read-file input must be an object");
  }
  const path = requireText(
    (input as { path?: unknown }).path,
    "money-mind read-file input.path",
  );
  return { path };
}

export function validateMoneyMindRunTestsInput(
  input: unknown,
): MoneyMindRunTestsInput {
  if (!input || typeof input !== "object") {
    throw new ValidationError("money-mind test input must be an object");
  }
  const script = (input as { script?: unknown }).script;
  if (!isMoneyMindScript(script)) {
    throw new ValidationError(
      `money-mind test input.script must be one of: ${MONEY_MIND_ALLOWED_SCRIPTS.join(", ")}`,
    );
  }
  return { script };
}

export function validateMoneyMindInspectStructureInput(
  input: unknown,
): MoneyMindInspectStructureInput {
  if (input === undefined || input === null) return {};
  if (typeof input !== "object") {
    throw new ValidationError("money-mind inspect input must be an object");
  }
  const path = (input as { path?: unknown }).path;
  const maxDepth = (input as { maxDepth?: unknown }).maxDepth;
  if (path !== undefined && typeof path !== "string") {
    throw new ValidationError("money-mind inspect input.path must be a string");
  }
  if (
    maxDepth !== undefined &&
    (!Number.isInteger(maxDepth) || (maxDepth as number) <= 0)
  ) {
    throw new ValidationError(
      "money-mind inspect input.maxDepth must be a positive integer",
    );
  }
  return {
    path: path as string | undefined,
    maxDepth: maxDepth as number | undefined,
  };
}

export function validateMoneyMindReadDocumentationInput(
  input: unknown,
): MoneyMindReadDocumentationInput {
  if (input === undefined || input === null) return {};
  if (typeof input !== "object") {
    throw new ValidationError("money-mind read-docs input must be an object");
  }
  const query = (input as { query?: unknown }).query;
  if (query !== undefined && typeof query !== "string") {
    throw new ValidationError(
      "money-mind read-docs input.query must be a string",
    );
  }
  return { query: query as string | undefined };
}
