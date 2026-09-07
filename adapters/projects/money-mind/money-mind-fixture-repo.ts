/**
 * Deterministic, in-memory `MoneyMindRepoPort`. Never touches disk, never
 * spawns a process — `runScript` returns a canned or synthesized result and
 * records the call so tests can assert exactly what would have run.
 *
 * The default fixture content below is SYNTHETIC test data written for this
 * repository. It is structurally analogous to a real Money Mind checkout
 * (a layered, feature-flagged status doc; a small doc set; a representative
 * source tree) so the adapter's parsing logic is exercised meaningfully, but
 * no file name, string, or value here is copied from the real Money Mind
 * project — see the Phase 6 ADR for the "no source copy" rationale.
 */
import {
  NotFoundError,
  type MoneyMindScript,
} from "../../../contracts/index.js";
import type {
  MoneyMindRepoPort,
  MoneyMindRunResult,
} from "./money-mind-repo-port.js";

export interface MoneyMindFixtureOptions {
  /** relative path -> full text content. Defaults to `defaultMoneyMindFixtureFiles()`. */
  files?: Record<string, string>;
  /** package.json `scripts` map. Defaults to a project with no test/typecheck script. */
  scripts?: Record<string, string>;
  /** Canned `runScript` results, keyed by script name. Falls back to a synthesized success. */
  scriptResults?: Partial<Record<MoneyMindScript, MoneyMindRunResult>>;
}

/** A representative, invented (non-Money-Mind) documentation + source fixture. */
export function defaultMoneyMindFixtureFiles(): Record<string, string> {
  return {
    "README.md": [
      "# Fixture Finance App",
      "",
      "A synthetic personal-finance web app used to exercise the Money Mind",
      "project adapter in tests. Frontend + a small backend, feature-flagged V2",
      "workspace.",
      "",
      "## Build",
      "",
      "npm run build",
    ].join("\n"),
    "CLAUDE.md": [
      "# CLAUDE.md — Fixture Finance App",
      "",
      "## V2 upgrade (current focus)",
      "V2 is an evolutionary upgrade behind centralized feature flags, off by",
      "default. Work proceeds in numbered layers; each layer is accepted only",
      "after recorded validation evidence.",
      "",
      "Status:",
      "- V2 Layer 1 Foundation (feature flags, contracts) — implemented, validated",
      "- V2 Layer 2 Spatial runtime (placeholder nodes) — implemented, validated",
      "- V2 Layer 3 Motion & interaction engine — implemented, validated",
      "- V2 Layer 4 Real domain data in the spatial nodes — implemented, validated",
      "- V2 Layer 5 Graph drill-down (graphEngine flag) — implemented, validated",
      "- V2 Layer 6 Simulation (simulation flag) — implemented, validated",
      "- NEXT: V2 Layer 7 (assistant integration) or productionizing the spatial view",
      "",
      "## Notes",
      "This project currently defines no automated `test` npm script; `build`",
      "and `lint` are the available quality gates.",
    ].join("\n"),
    "AGENTS.md": [
      "# AGENTS.md — Fixture Finance App",
      "",
      "Shared context for agent tooling. See CLAUDE.md for the current V2",
      "status; the same content applies here.",
    ].join("\n"),
    "docs/v2/README.md": [
      "# V2 documentation",
      "",
      "See docs/v2/chapter-registry.yaml for per-layer implementation and",
      "validation status.",
    ].join("\n"),
    "docs/v2/chapter-registry.yaml": [
      "chapters:",
      "  - number: 1",
      "    title: V2 Foundation",
      "    implementationStatus: implemented",
      "    validationStatus: validated",
      "  - number: 2",
      "    title: Spatial Runtime",
      "    implementationStatus: implemented",
      "    validationStatus: validated",
      "  - number: 3",
      "    title: Motion & Interaction Engine",
      "    implementationStatus: implemented",
      "    validationStatus: validated",
      "  - number: 4",
      "    title: Domain Data In Spatial Nodes",
      "    implementationStatus: implemented",
      "    validationStatus: validated",
      "  - number: 5",
      "    title: Graph Drill-down",
      "    implementationStatus: implemented",
      "    validationStatus: validated",
      "  - number: 6",
      "    title: Simulation Mode",
      "    implementationStatus: implemented",
      "    validationStatus: validated",
    ].join("\n"),
    ".env.example": [
      "# Fixture feature flags (safe placeholders, no secrets)",
      "APP_V2_ENABLED=false",
      "APP_V2_SPATIAL_UI=false",
      "APP_V2_GRAPH_ENGINE=false",
      "APP_V2_MOTION_ENGINE=false",
      "APP_V2_SIMULATION=false",
      "APP_V2_ASSISTANT=false",
    ].join("\n"),
    "src/app/main.js": "// fixture entry point\n",
    "src/core/featureFlags.js": "// fixture centralized feature flags\n",
    "src/financial/exampleModel.js": "// fixture financial domain model\n",
    "src/pages/Dashboard.jsx": "// fixture route screen\n",
    "src/services/exampleService.js": "// fixture data service\n",
  };
}

export class InMemoryMoneyMindRepo implements MoneyMindRepoPort {
  private readonly files: Map<string, string>;
  private readonly scripts: Record<string, string>;
  private readonly scriptResults: Partial<
    Record<MoneyMindScript, MoneyMindRunResult>
  >;

  /** Every `runScript` call, in order — tests assert exactly what was run. */
  readonly runCalls: MoneyMindScript[] = [];

  constructor(options: MoneyMindFixtureOptions = {}) {
    this.scripts = options.scripts ?? { build: "vite build", lint: "oxlint" };
    this.scriptResults = options.scriptResults ?? {};
    const files = { ...(options.files ?? defaultMoneyMindFixtureFiles()) };
    if (!files["package.json"]) {
      files["package.json"] = JSON.stringify(
        {
          name: "fixture-finance-app",
          version: "0.0.0",
          private: true,
          scripts: this.scripts,
        },
        null,
        2,
      );
    }
    this.files = new Map(Object.entries(files));
  }

  async exists(relPath: string): Promise<boolean> {
    if (relPath === "") return true;
    if (this.files.has(relPath)) return true;
    const prefix = `${relPath}/`;
    for (const key of this.files.keys()) {
      if (key.startsWith(prefix)) return true;
    }
    return false;
  }

  async readTextFile(relPath: string): Promise<string> {
    const content = this.files.get(relPath);
    if (content === undefined) {
      throw new NotFoundError(
        `file not found in money-mind fixture: ${relPath}`,
      );
    }
    return content;
  }

  async listDirectory(
    relPath: string,
  ): Promise<readonly { name: string; type: "file" | "dir" }[]> {
    const prefix = relPath === "" ? "" : `${relPath}/`;
    const seen = new Map<string, "file" | "dir">();
    for (const key of this.files.keys()) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      if (rest === "") continue;
      const slash = rest.indexOf("/");
      if (slash === -1) {
        seen.set(rest, "file");
      } else {
        const dirName = rest.slice(0, slash);
        if (!seen.has(dirName)) seen.set(dirName, "dir");
      }
    }
    return [...seen.entries()]
      .map(([name, type]) => ({ name, type }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async hasScript(script: MoneyMindScript): Promise<boolean> {
    return Object.prototype.hasOwnProperty.call(this.scripts, script);
  }

  async runScript(
    script: MoneyMindScript,
    _timeoutMs: number,
  ): Promise<MoneyMindRunResult> {
    this.runCalls.push(script);
    const canned = this.scriptResults[script];
    if (canned) return canned;
    return {
      exitCode: 0,
      stdout: `fixture: ${script} completed\n`,
      stderr: "",
      timedOut: false,
      durationMs: 5,
    };
  }
}
