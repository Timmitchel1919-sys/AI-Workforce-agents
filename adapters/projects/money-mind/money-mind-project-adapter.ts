/**
 * Money Mind project adapter.
 *
 * The ONLY door from the AI Workforce into Money Mind. Every operation is
 * declared, narrow, and structured — there is no "run any command" or
 * "read any file" escape hatch. All Money-Mind-specific domain knowledge
 * (which files carry status, how to parse them) lives here, behind the
 * generic `MoneyMindRepoPort`; nothing above this adapter (agents, the
 * orchestrator, core) knows anything about Money Mind's actual file layout.
 *
 * Read-only in this phase: every capability but `RUN_TESTS` only reads.
 * `RUN_TESTS` runs exactly one allowlisted npm script, never a raw string,
 * and never touches git-tracked source.
 */
import {
  type MoneyMindCapability,
  type MoneyMindChapterStatus,
  type MoneyMindDocumentationHit,
  type MoneyMindInspectStructureOutput,
  type MoneyMindReadConfigurationOutput,
  type MoneyMindReadDocumentationOutput,
  type MoneyMindReadFileOutput,
  type MoneyMindReadProjectOutput,
  type MoneyMindReadStatusOutput,
  type MoneyMindReadTestResultsOutput,
  type MoneyMindRunTestsOutput,
  type MoneyMindStructureEntry,
  MONEY_MIND_PROJECT_ID,
  NotFoundError,
  ValidationError,
  validateMoneyMindInspectStructureInput,
  validateMoneyMindReadDocumentationInput,
  validateMoneyMindReadFileInput,
  validateMoneyMindRunTestsInput,
} from "../../../contracts/index.js";
import type { ProjectOperation } from "../project-adapter.js";
import { BaseProjectAdapter } from "../project-adapter.js";
import {
  MONEY_MIND_IGNORED_DIRS,
  resolveSafeRelativePath,
} from "./money-mind-path-policy.js";
import type { MoneyMindRepoPort } from "./money-mind-repo-port.js";
import {
  parseMoneyMindChapterRegistry,
  parseMoneyMindFeatureFlagNames,
} from "./money-mind-status-parser.js";

const DOC_CANDIDATES: readonly string[] = [
  "README.md",
  "CLAUDE.md",
  "AGENTS.md",
  "docs/v2/README.md",
  "docs/v2/chapter-registry.yaml",
];
const CHAPTER_REGISTRY_PATH = "docs/v2/chapter-registry.yaml";
const FEATURE_FLAGS_PATH = ".env.example";
const PACKAGE_JSON_PATH = "package.json";

export interface MoneyMindProjectAdapterOptions {
  repo: MoneyMindRepoPort;
  repositoryUrl?: string;
  commandTimeoutMs?: number;
}

interface PackageJsonSummary {
  packageName?: string;
  packageVersion?: string;
  scripts: Record<string, string>;
}

export class MoneyMindProjectAdapter extends BaseProjectAdapter {
  readonly projectId = MONEY_MIND_PROJECT_ID;
  protected readonly displayName = "Money Mind";
  protected readonly operations: Record<string, ProjectOperation>;

  private readonly repo: MoneyMindRepoPort;
  private readonly repositoryUrl: string;
  private readonly commandTimeoutMs: number;
  private readonly maxFileChars = 20_000;
  private readonly maxOutputChars = 20_000;
  private readonly defaultInspectDepth = 3;
  private readonly maxInspectDepth = 6;
  private readonly maxInspectEntries = 300;

  constructor(options: MoneyMindProjectAdapterOptions) {
    super();
    this.repo = options.repo;
    this.repositoryUrl =
      options.repositoryUrl ??
      "https://github.com/Timmitchel1919-sys/Money-Mind.git";
    this.commandTimeoutMs = options.commandTimeoutMs ?? 60_000;

    this.operations = {
      READ_PROJECT: {
        capability: {
          operation: "READ_PROJECT",
          description: "Read the Money Mind project identity and profile.",
          action: "read",
        },
        handler: () => this.readProject(),
      },
      READ_STATUS: {
        capability: {
          operation: "READ_STATUS",
          description:
            "Read structured V2 chapter status and feature-flag names.",
          action: "read",
        },
        handler: () => this.readStatus(),
      },
      READ_TEST_RESULTS: {
        capability: {
          operation: "READ_TEST_RESULTS",
          description: "Report whether an automated test suite is configured.",
          action: "read",
        },
        handler: () => this.readTestResults(),
      },
      READ_CONFIGURATION: {
        capability: {
          operation: "READ_CONFIGURATION",
          description: "Read package name/version, npm scripts, feature flags.",
          action: "read",
        },
        handler: () => this.readConfiguration(),
      },
      READ_FILE: {
        capability: {
          operation: "READ_FILE",
          description:
            "Read a single text file by repository-relative path (sandboxed).",
          action: "read",
        },
        handler: (input) => this.readFile(input),
      },
      RUN_TESTS: {
        capability: {
          operation: "RUN_TESTS",
          description:
            "Run one allowlisted, existing npm script (build/lint/test/typecheck).",
          action: "execute",
        },
        handler: (input) => this.runTests(input),
      },
      INSPECT_STRUCTURE: {
        capability: {
          operation: "INSPECT_STRUCTURE",
          description:
            "List the repository's directory structure (paths + type only).",
          action: "read",
        },
        handler: (input) => this.inspectStructure(input),
      },
      READ_DOCUMENTATION: {
        capability: {
          operation: "READ_DOCUMENTATION",
          description:
            "Read (and optionally keyword-search) the project's documentation set.",
          action: "read",
        },
        handler: (input) => this.readDocumentation(input),
      },
    } satisfies Record<MoneyMindCapability, ProjectOperation>;
  }

  /* -------------------------------------------------------------- */
  /* operations                                                     */
  /* -------------------------------------------------------------- */

  private async readProject(): Promise<MoneyMindReadProjectOutput> {
    const pkg = await this.readPackageJsonSummary();
    return {
      projectId: MONEY_MIND_PROJECT_ID,
      name: this.displayName,
      description:
        "Independent personal-finance web application, reached only through " +
        "this read-mostly adapter. No Money Mind source lives in this repository.",
      repository: this.repositoryUrl,
      packageName: pkg.packageName,
      packageVersion: pkg.packageVersion,
      metadata: {
        integration: "adapter-only",
        sourceCopiedIntoWorkforce: false,
      },
    };
  }

  private async readStatus(): Promise<MoneyMindReadStatusOutput> {
    const chapters: MoneyMindChapterStatus[] = (await this.repo.exists(
      CHAPTER_REGISTRY_PATH,
    ))
      ? parseMoneyMindChapterRegistry(
          await this.repo.readTextFile(CHAPTER_REGISTRY_PATH),
        )
      : [];
    const featureFlags = await this.readFeatureFlagNames();

    const implemented = chapters.filter(
      (c) => c.implementationStatus === "implemented",
    ).length;
    const summary = chapters.length
      ? `${implemented}/${chapters.length} chapter(s) implemented`
      : "no chapter-registry document found at " + CHAPTER_REGISTRY_PATH;

    return { chapters, featureFlags, summary };
  }

  private async readTestResults(): Promise<MoneyMindReadTestResultsOutput> {
    const available = await this.repo.hasScript("test");
    return available
      ? {
          testsConfigured: true,
          message:
            'a "test" npm script is defined; call RUN_TESTS to execute it',
        }
      : {
          testsConfigured: false,
          message:
            'no automated test suite (npm script "test") is defined in this project',
        };
  }

  private async readConfiguration(): Promise<MoneyMindReadConfigurationOutput> {
    const pkg = await this.readPackageJsonSummary();
    const featureFlags = await this.readFeatureFlagNames();
    return {
      packageName: pkg.packageName,
      packageVersion: pkg.packageVersion,
      scripts: pkg.scripts,
      featureFlags,
    };
  }

  private async readFile(rawInput: unknown): Promise<MoneyMindReadFileOutput> {
    const { path: requested } = validateMoneyMindReadFileInput(rawInput);
    const safe = resolveSafeRelativePath(requested);
    if (!(await this.repo.exists(safe))) {
      throw new NotFoundError(
        `file not found in money-mind repository: ${requested}`,
      );
    }
    const content = await this.repo.readTextFile(safe);
    const truncated = content.length > this.maxFileChars;
    return {
      path: safe,
      content: truncated ? content.slice(0, this.maxFileChars) : content,
      bytes: Buffer.byteLength(content, "utf8"),
      truncated,
    };
  }

  private async runTests(rawInput: unknown): Promise<MoneyMindRunTestsOutput> {
    const { script } = validateMoneyMindRunTestsInput(rawInput);
    const available = await this.repo.hasScript(script);
    if (!available) {
      return {
        script,
        available: false,
        message: `no "${script}" npm script is defined in this project`,
      };
    }
    const result = await this.repo.runScript(script, this.commandTimeoutMs);
    return {
      script,
      available: true,
      message:
        result.exitCode === 0
          ? `"${script}" completed successfully`
          : `"${script}" exited with code ${result.exitCode}`,
      exitCode: result.exitCode,
      stdout: truncateText(result.stdout, this.maxOutputChars),
      stderr: truncateText(result.stderr, this.maxOutputChars),
      timedOut: result.timedOut,
      durationMs: result.durationMs,
    };
  }

  private async inspectStructure(
    rawInput: unknown,
  ): Promise<MoneyMindInspectStructureOutput> {
    const { path: startPath, maxDepth } =
      validateMoneyMindInspectStructureInput(rawInput);
    const root = startPath ? resolveSafeRelativePath(startPath) : "";
    const depthLimit = Math.min(
      maxDepth ?? this.defaultInspectDepth,
      this.maxInspectDepth,
    );

    if (!(await this.repo.exists(root))) {
      throw new NotFoundError(
        `directory not found in money-mind repository: ${startPath ?? "(root)"}`,
      );
    }

    const entries: MoneyMindStructureEntry[] = [];
    let truncated = false;

    const walk = async (relPath: string, depth: number): Promise<void> => {
      if (entries.length >= this.maxInspectEntries) {
        truncated = true;
        return;
      }
      let children: readonly { name: string; type: "file" | "dir" }[];
      try {
        children = await this.repo.listDirectory(relPath);
      } catch {
        return;
      }
      for (const child of children) {
        if (entries.length >= this.maxInspectEntries) {
          truncated = true;
          return;
        }
        if (child.type === "dir" && MONEY_MIND_IGNORED_DIRS.has(child.name)) {
          continue;
        }
        const childPath = relPath ? `${relPath}/${child.name}` : child.name;
        entries.push({ path: childPath, type: child.type });
        if (child.type === "dir" && depth < depthLimit) {
          await walk(childPath, depth + 1);
        }
      }
    };

    await walk(root, 1);
    return { root: root || "(repository root)", entries, truncated };
  }

  private async readDocumentation(
    rawInput: unknown,
  ): Promise<MoneyMindReadDocumentationOutput> {
    const { query } = validateMoneyMindReadDocumentationInput(rawInput);

    const docs: { path: string; content: string }[] = [];
    for (const candidate of DOC_CANDIDATES) {
      if (await this.repo.exists(candidate)) {
        docs.push({
          path: candidate,
          content: await this.repo.readTextFile(candidate),
        });
      }
    }

    const terms = (query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    const scored = docs.map((doc) => {
      const lower = doc.content.toLowerCase();
      const score =
        terms.length === 0
          ? 1
          : terms.reduce(
              (total, term) => total + (lower.includes(term) ? 1 : 0),
              0,
            );
      return { doc, score };
    });
    const matched =
      terms.length === 0 ? scored : scored.filter((s) => s.score > 0);
    const ranked = matched.sort((a, b) => b.score - a.score);

    const results: MoneyMindDocumentationHit[] = ranked.map(({ doc }) => ({
      title: titleFromPath(doc.path),
      reference: doc.path,
      snippet: truncateText(doc.content.trim(), 300),
      sourceType: "document",
    }));
    return { results };
  }

  /* -------------------------------------------------------------- */
  /* shared helpers                                                 */
  /* -------------------------------------------------------------- */

  private async readPackageJsonSummary(): Promise<PackageJsonSummary> {
    if (!(await this.repo.exists(PACKAGE_JSON_PATH))) {
      return { scripts: {} };
    }
    const raw = await this.repo.readTextFile(PACKAGE_JSON_PATH);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new ValidationError(
        `money-mind package.json is not valid JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (!parsed || typeof parsed !== "object") {
      return { scripts: {} };
    }
    const record = parsed as Record<string, unknown>;
    const scripts: Record<string, string> = {};
    if (record.scripts && typeof record.scripts === "object") {
      for (const [key, value] of Object.entries(
        record.scripts as Record<string, unknown>,
      )) {
        if (typeof value === "string") scripts[key] = value;
      }
    }
    return {
      packageName: typeof record.name === "string" ? record.name : undefined,
      packageVersion:
        typeof record.version === "string" ? record.version : undefined,
      scripts,
    };
  }

  private async readFeatureFlagNames(): Promise<string[]> {
    if (!(await this.repo.exists(FEATURE_FLAGS_PATH))) return [];
    return parseMoneyMindFeatureFlagNames(
      await this.repo.readTextFile(FEATURE_FLAGS_PATH),
    );
  }
}

function truncateText(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function titleFromPath(relPath: string): string {
  const base = relPath.split("/").pop() ?? relPath;
  return base.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]/g, " ");
}
