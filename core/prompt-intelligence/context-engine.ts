/**
 * Context Engine (Phase 3).
 *
 * Resolves WHICH context is relevant to an analysed intent — not all of it.
 * For every fragment it answers: what, why (relevance reasons), which source,
 * is it authoritative, and is it safe to expose to this audience.
 *
 * Pipeline:  sources → safety filter → conflict resolution (precedence)
 *            → relevance scoring → budget → ResolvedContext
 *
 * Guarantees (all enforced here, server-side):
 *  - project isolation: a fragment belonging to another project is dropped;
 *  - no secrets: a fragment whose text looks like a credential is dropped whole;
 *  - clearance: `restricted` fragments reach only a `restricted` audience;
 *  - precedence: security policy outranks everything but is itself never
 *    overridden — an instruction that conflicts with it is recorded, not obeyed;
 *  - a failing source degrades to a report entry; it never fails resolution
 *    and never leaks the error text.
 */
import {
  CONTEXT_CATEGORIES,
  precedenceRank,
  type ContextCategory,
  type ContextConflict,
  type ContextFragment,
  type ContextRequest,
  type ContextSource,
  type ExcludedFragment,
  type IntentAnalysis,
  type IntentCategory,
  type RelevantFileResolver,
  type ResolvedContext,
  type ResolvedFragment,
  type SourceReport,
  UNRESOLVED_PROJECT,
} from "../../contracts/prompt-intelligence.js";
import { containsSecret, sanitizeText } from "./secret-scan.js";

export interface ContextBudget {
  /** Maximum fragments of one category. */
  perCategory: number;
  /** Maximum total characters of fragment text. */
  maxChars: number;
  /** Maximum relevant files returned. */
  maxFiles: number;
}

export const DEFAULT_CONTEXT_BUDGET: ContextBudget = Object.freeze({
  perCategory: 6,
  maxChars: 6000,
  maxFiles: 8,
});

const INCLUDE_THRESHOLD = 0.5;
const MAX_VALUE = 600;

/** How central each context category is to each intent (0–1). */
type Weights = Readonly<Partial<Record<ContextCategory, number>>>;
const BASE_WEIGHTS: Weights = {
  project: 0.6,
  security: 0.7,
  development: 0.5,
  architecture: 0.35,
  ui: 0.1,
  task: 0.3,
  knowledge: 0.2,
  preference: 0.3,
};
const INTENT_WEIGHTS: Readonly<Partial<Record<IntentCategory, Weights>>> = {
  UI_MODIFICATION: { ui: 1, architecture: 0.4, development: 0.6 },
  THEME_MODIFICATION: { ui: 1, architecture: 0.5, development: 0.6 },
  FEATURE_IMPLEMENTATION: { architecture: 0.9, development: 0.9, ui: 0.4 },
  BUG_FIX: { architecture: 0.6, development: 0.8, task: 0.9 },
  REFACTOR: { architecture: 0.9, development: 0.9 },
  TESTING: { development: 1, architecture: 0.5 },
  CODE_REVIEW: { development: 0.9, architecture: 0.8, security: 0.9 },
  SECURITY_REVIEW: { security: 1, architecture: 0.8 },
  DEPLOYMENT: { development: 1, architecture: 0.6, security: 0.9 },
  DOCUMENTATION: { knowledge: 0.7, architecture: 0.7 },
  RESEARCH: { knowledge: 0.7 },
  CONFIGURATION: { development: 0.9, security: 0.9, architecture: 0.6 },
  DESTRUCTIVE_OPERATION: { security: 1, architecture: 0.7, task: 0.7 },
  PROJECT_MANAGEMENT: { task: 0.9, knowledge: 0.5 },
};

/** Categories whose absence makes the request under-specified for the intent. */
const NEEDED: Readonly<
  Partial<Record<IntentCategory, readonly ContextCategory[]>>
> = {
  UI_MODIFICATION: ["project", "ui"],
  THEME_MODIFICATION: ["project", "ui"],
  FEATURE_IMPLEMENTATION: ["project", "architecture"],
  REFACTOR: ["project", "architecture"],
  DEPLOYMENT: ["project", "development"],
  BUG_FIX: ["project"],
};

function weightFor(category: ContextCategory, intent: IntentCategory): number {
  return INTENT_WEIGHTS[intent]?.[category] ?? BASE_WEIGHTS[category] ?? 0.3;
}

const ENGINEERING: ReadonlySet<IntentCategory> = new Set([
  "DEPLOYMENT",
  "CONFIGURATION",
  "FEATURE_IMPLEMENTATION",
  "BUG_FIX",
  "REFACTOR",
  "TESTING",
  "CODE_REVIEW",
]);
const CODE_CHANGING: ReadonlySet<IntentCategory> = new Set([
  "UI_MODIFICATION",
  "THEME_MODIFICATION",
  "FEATURE_IMPLEMENTATION",
  "BUG_FIX",
  "REFACTOR",
  "TESTING",
  "CONFIGURATION",
  "DEPLOYMENT",
  "DESTRUCTIVE_OPERATION",
]);
const NON_TECHNICAL: ReadonlySet<IntentCategory> = new Set([
  "RESEARCH",
  "PROJECT_MANAGEMENT",
  "DOCUMENTATION",
  "UNKNOWN",
]);

/**
 * Per-fact centrality that overrides the category default. Repository URL,
 * branch, code and package manager are noise for a CSS tweak but essential for
 * a deployment; the project identity is always stated once.
 */
function keyWeight(
  fragment: ContextFragment,
  intent: IntentCategory,
): number | undefined {
  switch (`${fragment.category}.${fragment.key}`) {
    case "project.identity":
    case "task.current":
      return 1;
    case "project.repository":
    case "project.branch":
    case "project.code":
    case "project.packageManager":
    case "project.environment":
      return ENGINEERING.has(intent) ? 0.6 : 0.3;
    case "project.framework":
    case "project.frameworks":
    case "project.type":
    case "project.runtime":
    case "project.languages":
      return NON_TECHNICAL.has(intent) ? 0.3 : 0.55;
    case "development.parallel_work":
      return 0.2;
    case "development.validation":
    case "development.scope_discipline":
      return CODE_CHANGING.has(intent) ? 0.6 : 0.3;
    default:
      break;
  }
  if (fragment.category === "task" && fragment.key.startsWith("dependency."))
    return 0.9;
  if (fragment.category === "task" && fragment.key.startsWith("failure."))
    return intent === "BUG_FIX" ? 0.9 : 0.3;
  return undefined;
}

function termsOf(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/\p{L}[\p{L}\p{N}_-]{2,}/gu) ?? []);
}

function overlap(
  fragment: ContextFragment,
  keywords: readonly string[],
): string[] {
  const haystack = termsOf(
    `${fragment.key} ${fragment.value} ${fragment.origin}`,
  );
  const joined =
    `${fragment.key} ${fragment.value} ${fragment.origin}`.toLowerCase();
  return keywords.filter(
    (keyword) =>
      haystack.has(keyword) ||
      (keyword.length >= 4 && joined.includes(keyword)),
  );
}

export class ContextEngine {
  private readonly budget: ContextBudget;

  constructor(
    private readonly sources: readonly ContextSource[],
    private readonly options: {
      fileResolver?: RelevantFileResolver;
      budget?: Partial<ContextBudget>;
      clock?: () => string;
    } = {},
  ) {
    this.budget = { ...DEFAULT_CONTEXT_BUDGET, ...options.budget };
  }

  /** Source ids, for traceability and capability reporting. */
  get sourceIds(): string[] {
    return this.sources.map((s) => s.id);
  }

  async resolve(request: ContextRequest): Promise<ResolvedContext> {
    const excluded: ExcludedFragment[] = [];
    const reports: SourceReport[] = [];
    const collected: ContextFragment[] = [];

    // ---- 1. gather (a failing source degrades, never throws) ---------------
    for (const source of this.sources) {
      try {
        const fragments = await source.fetch(request);
        let accepted = 0;
        for (const raw of fragments) {
          const fragment = this.normalize(raw);
          const rejection = this.reject(fragment, request);
          if (rejection) {
            excluded.push({
              category: fragment.category,
              key: fragment.key,
              source: fragment.source,
              reason: rejection,
            });
            continue;
          }
          collected.push(fragment);
          accepted += 1;
        }
        reports.push({
          source: source.id,
          status: accepted > 0 ? "ok" : "empty",
          fragments: accepted,
        });
      } catch {
        reports.push({
          source: source.id,
          status: "unavailable",
          fragments: 0,
          note: "source failed; its context is absent from this request",
        });
      }
    }

    // ---- 2. conflicts (precedence) ----------------------------------------
    const { winners, conflicts, overridden } = this.resolveConflicts(collected);
    excluded.push(...overridden);

    // ---- 3. security overrides requested by the user ----------------------
    conflicts.push(...this.securityConflicts(winners, request.intent));

    // ---- 4. relevance + budget -------------------------------------------
    const scored = winners.map((fragment) =>
      this.score(fragment, request.intent),
    );
    const included: ResolvedFragment[] = [];
    const perCategory = new Map<ContextCategory, number>();
    let chars = 0;
    const ordered = [...scored].sort(
      (a, b) =>
        Number(b.mandatory === true) - Number(a.mandatory === true) ||
        b.relevance.score - a.relevance.score ||
        precedenceRank(a.precedence) - precedenceRank(b.precedence),
    );
    for (const fragment of ordered) {
      const mandatory = fragment.mandatory === true;
      if (!mandatory && fragment.relevance.score < INCLUDE_THRESHOLD) {
        excluded.push({
          category: fragment.category,
          key: fragment.key,
          source: fragment.source,
          reason: "not_relevant",
        });
        continue;
      }
      const count = perCategory.get(fragment.category) ?? 0;
      if (
        !mandatory &&
        (count >= this.budget.perCategory ||
          chars + fragment.value.length > this.budget.maxChars)
      ) {
        excluded.push({
          category: fragment.category,
          key: fragment.key,
          source: fragment.source,
          reason: "over_budget",
        });
        continue;
      }
      perCategory.set(fragment.category, count + 1);
      chars += fragment.value.length;
      included.push(fragment);
    }
    included.sort(
      (a, b) =>
        CONTEXT_CATEGORIES.indexOf(a.category) -
          CONTEXT_CATEGORIES.indexOf(b.category) ||
        precedenceRank(a.precedence) - precedenceRank(b.precedence),
    );

    // ---- 5. relevant files -----------------------------------------------
    const files = new Set<string>();
    for (const fragment of included)
      for (const file of fragment.files ?? []) files.add(file);
    // No repository lookup for a request whose project is unknown.
    if (this.options.fileResolver && request.projectId !== UNRESOLVED_PROJECT) {
      const resolved = await this.options.fileResolver
        .resolve(request.projectId, request.intent.keywords)
        .catch(() => ({ ok: false as const, note: "file resolution failed" }));
      reports.push({
        source: "relevant-files",
        status: resolved.ok
          ? resolved.files.length > 0
            ? "ok"
            : "empty"
          : "unavailable",
        fragments: resolved.ok ? resolved.files.length : 0,
        ...(resolved.note ? { note: resolved.note } : {}),
      });
      if (resolved.ok) for (const file of resolved.files) files.add(file);
    }

    const byCategory = Object.fromEntries(
      CONTEXT_CATEGORIES.map((c) => [
        c,
        included.filter((f) => f.category === c),
      ]),
    ) as Record<ContextCategory, ResolvedFragment[]>;
    const needed = NEEDED[request.intent.category] ?? [];
    return {
      projectId: request.projectId,
      fragments: included,
      byCategory,
      relevantFiles: [...files].slice(0, this.budget.maxFiles),
      previousDecisions: included.filter(
        (f) => f.precedence === "approved_project_decision",
      ),
      constraints: [
        ...request.intent.explicitConstraints,
        ...request.intent.impliedConstraints,
      ],
      conflicts,
      excluded,
      sources: reports,
      missing: needed.filter((category) => byCategory[category].length === 0),
      audience: request.audience,
      resolvedAt: (this.options.clock ?? (() => new Date().toISOString()))(),
    };
  }

  /* ---------------------------------------------------------------- */

  private normalize(fragment: ContextFragment): ContextFragment {
    return {
      ...fragment,
      key: sanitizeText(fragment.key, 80),
      value: sanitizeText(fragment.value, MAX_VALUE),
      origin: sanitizeText(fragment.origin, 120),
    };
  }

  private reject(
    fragment: ContextFragment,
    request: ContextRequest,
  ): ExcludedFragment["reason"] | undefined {
    if (
      fragment.projectId !== undefined &&
      fragment.projectId !== request.projectId
    ) {
      return "wrong_project";
    }
    if (containsSecret(fragment.value) || containsSecret(fragment.key)) {
      return "secret_content";
    }
    if (
      fragment.sensitivity === "restricted" &&
      request.audience.clearance !== "restricted"
    ) {
      return "not_cleared_for_audience";
    }
    return undefined;
  }

  private resolveConflicts(fragments: readonly ContextFragment[]): {
    winners: ContextFragment[];
    conflicts: ContextConflict[];
    overridden: ExcludedFragment[];
  } {
    const groups = new Map<string, ContextFragment[]>();
    for (const fragment of fragments) {
      const id = `${fragment.category}\u0000${fragment.key}`;
      const list = groups.get(id) ?? [];
      list.push(fragment);
      groups.set(id, list);
    }
    const winners: ContextFragment[] = [];
    const conflicts: ContextConflict[] = [];
    const overridden: ExcludedFragment[] = [];
    for (const list of groups.values()) {
      const ranked = [...list].sort(
        (a, b) => precedenceRank(a.precedence) - precedenceRank(b.precedence),
      );
      const winner = ranked[0]!;
      winners.push(winner);
      for (const other of ranked.slice(1)) {
        if (other.value === winner.value) continue;
        conflicts.push({
          category: winner.category,
          key: winner.key,
          winner: {
            source: winner.source,
            precedence: winner.precedence,
            value: winner.value,
          },
          overridden: {
            source: other.source,
            precedence: other.precedence,
            value: other.value,
          },
        });
        overridden.push({
          category: other.category,
          key: other.key,
          source: other.source,
          reason: "overridden",
        });
      }
    }
    return { winners, conflicts, overridden };
  }

  /** An instruction that conflicts with a security fragment loses — visibly. */
  private securityConflicts(
    winners: readonly ContextFragment[],
    intent: IntentAnalysis,
  ): ContextConflict[] {
    if (intent.securityOverrideAttempts.length === 0) return [];
    const policy = winners.find(
      (f) => f.precedence === "project_security_policy",
    );
    if (!policy) return [];
    return intent.securityOverrideAttempts.map((attempt) => ({
      category: "security" as const,
      key: "user_instruction",
      winner: {
        source: policy.source,
        precedence: policy.precedence,
        value: policy.value,
      },
      overridden: {
        source: "user-request",
        precedence: "explicit_user_instruction" as const,
        value: attempt,
      },
    }));
  }

  private score(
    fragment: ContextFragment,
    intent: IntentAnalysis,
  ): ResolvedFragment {
    const reasons: string[] = [];
    let score =
      keyWeight(fragment, intent.category) ??
      weightFor(fragment.category, intent.category);
    if (fragment.mandatory) {
      reasons.push("mandatory: security policy always applies");
      score = Math.max(score, 1);
    } else {
      reasons.push(`${fragment.category} context for ${intent.category}`);
    }
    const hits = overlap(fragment, intent.keywords);
    if (hits.length > 0) {
      score += Math.min(0.6, hits.length * 0.2);
      reasons.push(`matches request terms: ${hits.slice(0, 4).join(", ")}`);
    }
    if (
      fragment.precedence === "approved_project_decision" &&
      hits.length > 0
    ) {
      score += 0.2;
      reasons.push("approved project decision relevant to the request");
    }
    return {
      ...fragment,
      relevance: { score: Math.min(2, Number(score.toFixed(2))), reasons },
    };
  }
}
