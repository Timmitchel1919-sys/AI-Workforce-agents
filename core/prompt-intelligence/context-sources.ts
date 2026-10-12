/**
 * Built-in context sources (Phase 3).
 *
 * Every source reads EXISTING platform state through a narrow structural port
 * (Project Registry, ContextSystem, Knowledge repository, tasks, the
 * onboarding plan, the read-only repository reader). Nothing here duplicates
 * those systems and none of them can write. A source scopes its output to
 * `request.projectId`; the engine re-checks this defensively.
 */
import type {
  ContextCategory,
  ContextFragment,
  ContextRequest,
  ContextSource,
  RelevantFileResolver,
} from "../../contracts/prompt-intelligence.js";
import type { ContextSystem } from "../context/context-system.js";
import type { ProjectRegistry } from "../registry/project-registry.js";
import { parseProjectRepositoryRef } from "../registry/project-repository-ref.js";
import type { RepositorySourceReader } from "../onboarding/repository-source.js";

/* ------------------------------------------------------------------ */
/* Platform-wide (project-agnostic) policy                            */
/* ------------------------------------------------------------------ */

function policy(key: string, value: string): ContextFragment {
  return {
    category: "security",
    key,
    value,
    source: "platform-security-baseline",
    origin: "AI Workforce security baseline",
    authority: "authoritative",
    precedence: "project_security_policy",
    sensitivity: "internal",
    mandatory: true,
  };
}

/** The security rules every prompt carries. Mandatory and never overridable. */
export class PlatformSecurityBaselineSource implements ContextSource {
  readonly id = "platform-security-baseline";
  readonly categories: readonly ContextCategory[] = ["security"];
  fetch(): readonly ContextFragment[] {
    return [
      policy(
        "least_privilege",
        "Use the least privilege necessary; request only the capabilities the task needs.",
      ),
      policy(
        "secrets",
        "Never read, print, log, commit or transmit secrets or credentials; refer to them by variable name only.",
      ),
      policy(
        "authorization",
        "Authentication is not authorization: enforce authorization server-side; frontend visibility is never access control.",
      ),
      policy(
        "destructive_actions",
        "Destructive operations (deleting files, repositories, projects, agents, workflows, integrations, environments, configuration, secrets or data) require explicit human approval before execution.",
      ),
      policy(
        "project_isolation",
        "Stay inside this project: do not read, write or reference another project's data, repositories, secrets or budgets.",
      ),
      policy(
        "audit",
        "Every consequential action must be auditable; do not disable or bypass audit logging.",
      ),
      policy(
        "security_controls",
        "Do not weaken, bypass or remove any authentication, authorization, approval, validation or security-rule control.",
      ),
    ];
  }
}

function standard(key: string, value: string): ContextFragment {
  return {
    category: "development",
    key,
    value,
    source: "platform-development-defaults",
    origin: "AI Workforce development defaults",
    authority: "authoritative",
    precedence: "general_default",
    sensitivity: "public",
  };
}

/** Lowest-precedence defaults; any project fragment with the same key wins. */
export class PlatformDevelopmentDefaultsSource implements ContextSource {
  readonly id = "platform-development-defaults";
  readonly categories: readonly ContextCategory[] = ["development"];
  fetch(): readonly ContextFragment[] {
    return [
      standard(
        "validation",
        "Run the project's own typecheck, lint, tests and build before declaring work complete; do not weaken tests to make them pass.",
      ),
      standard(
        "scope_discipline",
        "Modify only what the request requires; do not touch unrelated files, and report every changed file.",
      ),
      standard(
        "parallel_work",
        "Parallel agents must not modify the same files at the same time; shared interfaces are defined first.",
      ),
    ];
  }
}

/* ------------------------------------------------------------------ */
/* Project registry                                                   */
/* ------------------------------------------------------------------ */

export class ProjectRegistrySource implements ContextSource {
  readonly id = "project-registry";
  readonly categories: readonly ContextCategory[] = ["project"];
  constructor(private readonly registry: ProjectRegistry) {}

  fetch(request: ContextRequest): readonly ContextFragment[] {
    const registration = this.registry.get(request.projectId);
    if (!registration) return [];
    const base = {
      category: "project" as const,
      source: this.id,
      origin: "Project Registry",
      authority: "authoritative" as const,
      precedence: "project_architecture_rule" as const,
      sensitivity: "internal" as const,
      projectId: request.projectId,
    };
    const out: ContextFragment[] = [
      {
        ...base,
        key: "identity",
        value: `${registration.displayName} (id: ${registration.projectId})`,
      },
    ];
    const repository = registration.metadata["repository"]
      ? parseProjectRepositoryRef(registration.metadata["repository"])
      : undefined;
    if (repository) {
      out.push({ ...base, key: "repository", value: repository.url });
      out.push({
        ...base,
        key: "branch",
        value: `default branch: ${repository.defaultBranch}`,
      });
    }
    const code = registration.metadata["code"];
    if (typeof code === "string")
      out.push({ ...base, key: "code", value: `project code ${code}` });
    return out;
  }
}

/* ------------------------------------------------------------------ */
/* ContextSystem values + static profiles                             */
/* ------------------------------------------------------------------ */

const NAMESPACE: Readonly<
  Record<string, readonly [ContextCategory, ContextFragment["precedence"]]>
> = {
  project: ["project", "project_documentation"],
  architecture: ["architecture", "project_architecture_rule"],
  ui: ["ui", "project_architecture_rule"],
  security: ["security", "project_security_policy"],
  development: ["development", "project_architecture_rule"],
  preference: ["preference", "general_default"],
};

function stringify(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (Array.isArray(value) && value.every((v) => typeof v === "string"))
    return value.join("; ");
  return undefined;
}

/** Turns `namespace.key → value` entries into fragments for one project. */
export function fragmentsFromValues(
  projectId: string,
  values: Readonly<Record<string, unknown>>,
  source: string,
  origin: string,
  authority: ContextFragment["authority"] = "authoritative",
): ContextFragment[] {
  const out: ContextFragment[] = [];
  for (const [name, raw] of Object.entries(values)) {
    const dot = name.indexOf(".");
    const mapped = dot > 0 ? NAMESPACE[name.slice(0, dot)] : undefined;
    const text = stringify(raw);
    if (!mapped || text === undefined || text === "") continue;
    out.push({
      category: mapped[0],
      key: name.slice(dot + 1),
      value: text,
      source,
      origin,
      authority,
      precedence: mapped[1],
      sensitivity: "internal",
      projectId,
      mandatory:
        mapped[0] === "security" && mapped[1] === "project_security_policy",
    });
  }
  return out;
}

/** Project configuration held in the platform `ContextSystem` (project-isolated). */
export class ProjectContextValuesSource implements ContextSource {
  readonly id = "project-context";
  readonly categories: readonly ContextCategory[] = [
    "project",
    "architecture",
    "ui",
    "security",
    "development",
    "preference",
  ];
  constructor(
    private readonly contexts: Pick<ContextSystem, "getProjectContext">,
  ) {}

  fetch(request: ContextRequest): readonly ContextFragment[] {
    const context = this.contexts.getProjectContext(request.projectId);
    return context
      ? fragmentsFromValues(
          request.projectId,
          context.values,
          this.id,
          "Project context",
          "authoritative",
        )
      : [];
  }
}

/** A fixed, reviewed profile for one project (facts taken from its own repo docs). */
export class StaticProjectProfileSource implements ContextSource {
  readonly categories: readonly ContextCategory[] = [
    "project",
    "architecture",
    "ui",
    "security",
    "development",
  ];
  constructor(
    readonly id: string,
    private readonly projectId: string,
    private readonly origin: string,
    private readonly values: Readonly<Record<string, unknown>>,
  ) {}

  fetch(request: ContextRequest): readonly ContextFragment[] {
    return request.projectId === this.projectId
      ? fragmentsFromValues(
          this.projectId,
          this.values,
          this.id,
          this.origin,
          "authoritative",
        )
      : [];
  }
}

/**
 * The AI Workforce platform's own profile. Every fact is from AGENTS.md,
 * package.json, firebase.json or the shipped UI — nothing is inferred.
 */
export const AI_WORKFORCE_PROFILE: Readonly<Record<string, unknown>> =
  Object.freeze({
    "project.type":
      "Control Plane API (Node.js, Firebase Functions) plus React Control Center",
    "project.runtime": "Node.js 20+, TypeScript strict, ESM / NodeNext",
    "project.framework":
      "React 19 + Vite (ui/); Firebase Functions 2nd gen and Hosting",
    "project.packageManager": "npm",
    "project.environment": "Firebase project ai-workforce-agents",
    "architecture.layers":
      "contracts → core → control services → HTTP API; adapters implement ports; UI → Control Plane API",
    "architecture.frontendBoundary":
      "The frontend communicates only through the Control Plane API; it must never access Firestore directly.",
    "architecture.reuse":
      "Extend existing modules; do not create duplicate registries, routers or workflow systems.",
    "ui.designSystem":
      "Liquid Glass design system with Dark and Light themes; use existing UI components and CSS tokens.",
    "ui.localization":
      "All user-facing strings need English and Dutch with key parity.",
    "ui.accessibility":
      "Keyboard accessible, semantic forms with labels, responsive with no horizontal overflow.",
    "development.standards":
      "TypeScript strict; ESM / NodeNext; follow docs/development/coding-standards.md.",
    "development.testing":
      "Backend: npm test (node --test); UI: vitest. Add or update tests with every implementation.",
    "development.deployment":
      "firebase deploy to ai-workforce-agents; Functions only when the backend changed, Hosting for UI changes.",
    "development.branching":
      "Each parallel lane uses an isolated Git branch or worktree; never force-push.",
  });

/* ------------------------------------------------------------------ */
/* Knowledge                                                          */
/* ------------------------------------------------------------------ */

export interface KnowledgeRecord {
  id: string;
  projectId?: string;
  type: string;
  title: string;
  body: string;
  tags: readonly string[];
  source?: string;
  updatedAt: string;
}
export interface KnowledgeReader {
  list(): readonly KnowledgeRecord[];
}

const KNOWLEDGE_MAP: Readonly<
  Record<
    string,
    {
      precedence: ContextFragment["precedence"];
      authority: ContextFragment["authority"];
      category: ContextCategory;
    }
  >
> = {
  decision: {
    precedence: "approved_project_decision",
    authority: "curated",
    category: "knowledge",
  },
  architecture: {
    precedence: "project_documentation",
    authority: "curated",
    category: "architecture",
  },
  requirement: {
    precedence: "project_documentation",
    authority: "curated",
    category: "knowledge",
  },
  technical_documentation: {
    precedence: "project_documentation",
    authority: "curated",
    category: "knowledge",
  },
  project_knowledge: {
    precedence: "project_documentation",
    authority: "curated",
    category: "knowledge",
  },
  note: {
    precedence: "project_documentation",
    authority: "advisory",
    category: "knowledge",
  },
};

const FILE_HINT =
  /(?:^|[\s("'`])((?:[\w.-]+\/)+[\w.-]+\.(?:tsx?|jsx?|css|json|md|html))(?=$|[\s)"'`,.;:])/g;

/** Approved Knowledge items (the existing Knowledge repository), per project. */
export class KnowledgeContextSource implements ContextSource {
  readonly id = "knowledge";
  readonly categories: readonly ContextCategory[] = [
    "knowledge",
    "architecture",
  ];
  constructor(private readonly reader: KnowledgeReader) {}

  fetch(request: ContextRequest): readonly ContextFragment[] {
    const out: ContextFragment[] = [];
    for (const item of this.reader.list()) {
      // Project-scoped items for THIS project, or platform-wide items only.
      if (item.projectId !== undefined && item.projectId !== request.projectId)
        continue;
      const mapped = KNOWLEDGE_MAP[item.type] ?? KNOWLEDGE_MAP["note"]!;
      const files = [...item.body.matchAll(FILE_HINT)]
        .map((m) => m[1]!)
        .slice(0, 5);
      out.push({
        category: mapped.category,
        key: `kb.${item.id}`,
        value: `${item.title}: ${item.body}`,
        source: this.id,
        origin: `Knowledge: ${item.title}`,
        authority: mapped.authority,
        precedence: mapped.precedence,
        sensitivity: "internal",
        ...(item.projectId !== undefined ? { projectId: item.projectId } : {}),
        ...(files.length > 0 ? { files } : {}),
      });
    }
    return out;
  }
}

/* ------------------------------------------------------------------ */
/* Tasks                                                              */
/* ------------------------------------------------------------------ */

export interface TaskRecordLike {
  id: string;
  projectId: string;
  description: string;
  status: string;
  errors: readonly string[];
  objective?: string;
  requirements?: readonly string[];
  dependencies?: readonly string[];
  updatedAt: string;
}
export interface TaskReader {
  list(): readonly TaskRecordLike[];
}

/** Current task, its dependencies and recent failures — this project only. */
export class TaskContextSource implements ContextSource {
  readonly id = "task-history";
  readonly categories: readonly ContextCategory[] = ["task"];
  constructor(private readonly tasks: TaskReader) {}

  fetch(request: ContextRequest): readonly ContextFragment[] {
    const mine = this.tasks
      .list()
      .filter((t) => t.projectId === request.projectId);
    const base = {
      category: "task" as const,
      source: this.id,
      origin: "Task history",
      authority: "derived" as const,
      precedence: "current_task_context" as const,
      sensitivity: "internal" as const,
      projectId: request.projectId,
    };
    const out: ContextFragment[] = [];
    const current = request.taskId
      ? mine.find((t) => t.id === request.taskId)
      : undefined;
    if (current) {
      out.push({
        ...base,
        key: "current",
        mandatory: false,
        value: `Task ${current.id}: ${current.objective ?? current.description}`,
      });
      for (const dependency of current.dependencies ?? []) {
        const parent = mine.find((t) => t.id === dependency);
        if (parent) {
          out.push({
            ...base,
            key: `dependency.${parent.id}`,
            value: `Depends on ${parent.id} (${parent.status}): ${parent.description}`,
          });
        }
      }
    }
    const failures = mine
      .filter((t) => t.status === "failed" && t.errors.length > 0)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 3);
    for (const failed of failures) {
      out.push({
        ...base,
        key: `failure.${failed.id}`,
        value: `Previous failure in ${failed.id}: ${failed.errors[0]}`,
      });
    }
    return out;
  }
}

/* ------------------------------------------------------------------ */
/* Onboarding plan (discovered project facts)                         */
/* ------------------------------------------------------------------ */

export interface OnboardedProjectReader {
  get(projectId: string): Promise<
    | {
        plan?: {
          technology?: {
            languages?: readonly { value: string }[];
            frameworks?: readonly { value: string }[];
            packageManagers?: readonly { value: string }[];
            testSystems?: readonly { value: string }[];
          };
          pipeline?: readonly {
            stage: string;
            status: string;
            command?: string;
          }[];
          deployment?: { targets?: readonly { provider: string }[] };
          git?: {
            defaultBranch?: string;
            testsRequired?: boolean;
            reviewRequired?: boolean;
          };
          secrets?: readonly { name: string }[];
        };
      }
    | undefined
  >;
}

/** Facts the onboarding discovery established (evidence-based, derived). */
export class OnboardedProjectSource implements ContextSource {
  readonly id = "onboarding-plan";
  readonly categories: readonly ContextCategory[] = [
    "project",
    "development",
    "security",
  ];
  constructor(private readonly reader: OnboardedProjectReader) {}

  async fetch(request: ContextRequest): Promise<readonly ContextFragment[]> {
    const project = await this.reader.get(request.projectId);
    const plan = project?.plan;
    if (!plan) return [];
    const base = {
      source: this.id,
      origin: "Approved onboarding plan",
      authority: "derived" as const,
      precedence: "project_documentation" as const,
      sensitivity: "internal" as const,
      projectId: request.projectId,
    };
    const list = (items?: readonly { value: string }[]): string =>
      (items ?? []).map((i) => i.value).join(", ");
    const out: ContextFragment[] = [];
    const tech = plan.technology;
    if (list(tech?.languages))
      out.push({
        ...base,
        category: "project",
        key: "languages",
        value: list(tech?.languages),
      });
    if (list(tech?.frameworks))
      out.push({
        ...base,
        category: "project",
        key: "frameworks",
        value: list(tech?.frameworks),
      });
    if (list(tech?.packageManagers))
      out.push({
        ...base,
        category: "project",
        key: "packageManager",
        value: list(tech?.packageManagers),
      });
    if (list(tech?.testSystems))
      out.push({
        ...base,
        category: "development",
        key: "testFrameworks",
        value: list(tech?.testSystems),
      });
    for (const step of plan.pipeline ?? []) {
      if (step.status === "resolved" && step.command) {
        out.push({
          ...base,
          category: "development",
          key: `command.${step.stage}`,
          value: `${step.stage}: ${step.command}`,
        });
      }
    }
    const targets = (plan.deployment?.targets ?? [])
      .map((t) => t.provider)
      .join(", ");
    if (targets)
      out.push({
        ...base,
        category: "development",
        key: "deployment",
        value: `deployment targets: ${targets}`,
      });
    if (plan.git) {
      out.push({
        ...base,
        category: "development",
        key: "git",
        value: `default branch ${plan.git.defaultBranch ?? "unknown"}; tests required: ${plan.git.testsRequired === true}; review required: ${plan.git.reviewRequired === true}`,
      });
    }
    const names = (plan.secrets ?? []).map((s) => s.name);
    if (names.length > 0) {
      out.push({
        ...base,
        category: "security",
        key: "required_variables",
        value: `Required environment variables (names only, never values): ${names.join(", ")}`,
      });
    }
    return out;
  }
}

/* ------------------------------------------------------------------ */
/* Relevant files (read-only repository listing)                      */
/* ------------------------------------------------------------------ */

const CODE_FILE =
  /\.(?:tsx?|jsx?|css|scss|html|vue|svelte|py|java|kt|swift|cs|go|rs)$/i;

function pathTerms(path: string): Set<string> {
  const spaced = path
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[/._-]+/g, " ")
    .toLowerCase();
  return new Set(spaced.split(/\s+/).filter((t) => t.length >= 3));
}

/**
 * Finds likely-relevant files in the project's bound repository using the
 * READ-ONLY repository reader. It never clones, writes or executes anything,
 * and says so honestly when the repository cannot be read.
 */
export class RepositoryFileResolver implements RelevantFileResolver {
  private readonly cache = new Map<
    string,
    { at: number; paths: readonly string[] }
  >();
  constructor(
    private readonly registry: ProjectRegistry,
    private readonly reader: RepositorySourceReader,
    private readonly options: {
      ttlMs?: number;
      limit?: number;
      now?: () => number;
    } = {},
  ) {}

  async resolve(projectId: string, keywords: readonly string[]) {
    const registration = this.registry.get(projectId);
    const repository = registration?.metadata["repository"]
      ? parseProjectRepositoryRef(registration.metadata["repository"])
      : undefined;
    if (!repository) {
      return {
        ok: false as const,
        note: "no repository is bound to this project",
      };
    }
    const now = (this.options.now ?? Date.now)();
    let entry = this.cache.get(projectId);
    if (!entry || now - entry.at > (this.options.ttlMs ?? 5 * 60_000)) {
      const result = await this.reader.read({
        provider: "github",
        url: repository.url,
      });
      if (!result.ok) {
        return {
          ok: false as const,
          note: `repository could not be read (${result.code})`,
        };
      }
      entry = {
        at: now,
        paths: result.evidence.paths.filter((p) => CODE_FILE.test(p)),
      };
      this.cache.set(projectId, entry);
    }
    const wanted = new Set(keywords.map((k) => k.toLowerCase()));
    const scored = entry.paths
      .map((path) => {
        const terms = pathTerms(path);
        let score = 0;
        for (const term of terms) if (wanted.has(term)) score += 1;
        return { path, score };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score || a.path.length - b.path.length)
      .slice(0, this.options.limit ?? 8)
      .map((s) => s.path);
    return {
      ok: true as const,
      files: scored,
      ...(scored.length === 0
        ? { note: "no file path matched the request terms" }
        : {}),
    };
  }
}
