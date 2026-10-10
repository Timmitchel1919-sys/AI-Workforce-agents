/**
 * Intent Analyzer (Phase 3) — rule-based, deterministic, bilingual (NL/EN).
 *
 * Turns a natural-language request into a typed `IntentAnalysis`. It is
 * deliberately NOT model-assisted: an analysis that feeds destructive-action
 * and approval decisions must be explainable and reproducible. The
 * `IntentAnalyzer` port lets a model-assisted analyzer be added later; the
 * validator re-checks whatever any analyzer returns.
 *
 * Nothing is guessed silently: what cannot be determined is reported as
 * ambiguity, low-risk gaps get a recorded safe default, high-risk gaps need
 * a human.
 */
import type {
  AmbiguityIssue,
  IntentAnalysis,
  IntentCategory,
  ProjectResolution,
  RequiredCapability,
  RiskLevel,
} from "../../contracts/prompt-intelligence.js";
import { canonicalizeCapability } from "../../contracts/capabilities.js";
import {
  detectDestructive,
  detectSecurityOverrides,
} from "./destructive-detector.js";

export interface ProjectCandidate {
  projectId: string;
  displayName: string;
  code?: string;
}

export interface IntentAnalyzerInput {
  request: string;
  /** Only projects the principal may access — never a wider list. */
  projects: readonly ProjectCandidate[];
  /** Explicit selection (e.g. the Command Center project picker). */
  explicitProjectId?: string;
}

export interface IntentAnalyzer {
  analyze(input: IntentAnalyzerInput): IntentAnalysis;
}

/* ------------------------------------------------------------------ */
/* Lexicon                                                            */
/* ------------------------------------------------------------------ */

const STOP = new Set(
  (
    "de het een the a an of van voor aan op in met to for on at by is zijn are was be dat die dit deze this that and en of or maar but " +
    "te naar from uit er ook nog wel niet not dan als if om ik je jij we wij u mijn onze our my your please graag kun kunt can could " +
    "would zou wil want need moet should must nieuwe nieuw new huidige current bestaande existing alle all"
  ).split(/\s+/),
);

const ACTION_WORDS = new Set(
  (
    "maak make verander change pas update wijzig modify zet set maakt aanpassen aan pas verbeter improve fix repareer los add voeg " +
    "bouw build create implement deploy run"
  ).split(/\s+/),
);

const DUTCH_MARKERS = new Set(
  (
    "de het een van maak verander naar niets anders maar boven beneden en voor met zonder alleen wijzig pas aan voeg toe nieuwe " +
    "kleiner groter breder compacter loginpagina graag dat niet ook"
  ).split(/\s+/),
);
const ENGLISH_MARKERS = new Set(
  "the make change to nothing else but top bottom and for with without only modify add new smaller larger wider please that not also".split(
    /\s+/,
  ),
);

const SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  login: ["auth", "signin", "sign-in", "authentication"],
  loginpagina: ["login", "auth"],
  card: ["kaart", "panel"],
  kaart: ["card"],
  pagina: ["page"],
  page: ["pagina"],
  knop: ["button"],
  button: ["knop"],
  thema: ["theme"],
  theme: ["thema"],
  formulier: ["form"],
  form: ["formulier"],
};

const STYLE_RE =
  /\b(compacter|compact|tighter|smaller|narrower|wider|breder|bredere|groter|bigger|larger|kleiner|padding|margin|spacing|ruimte|witruimte|boven en beneden|bovenaan en onderaan|top (?:and|&) bottom|vertical(?:ly)?|verticaal|horizontal(?:ly)?|horizontaal|hoogte|height|breedte|width|font|lettertype|kleur(?:en)?|colou?rs?|style|styling|layout|rounded|afgerond|schaduw|shadow|border|rand|responsive|animatie|animation|gap)\b/i;
const THEME_RE =
  /\b(theme|thema|dark mode|light mode|donkere? modus|liquid glass|kleurenschema|colou?r scheme)\b/i;
const BUG_RE =
  /\b(fix|bug|bugs|fout|foutmelding|error|crash(?:es|t)?|werkt niet|doesn'?t work|not working|broken|kapot|repareer|repair|oplossen|probleem|issue|regression)\b|\blos\b.{0,40}\bop\b/i;
const DEPLOY_RE =
  /\b(deploy|deployen|deployment|uitrollen|uitrol|publish|publiceer|release|live zetten|go live|rollout)\b/i;
const SECURITY_RE =
  /\b(security|beveiliging|kwetsbaar\w*|vulnerabilit\w*|pentest|owasp|threat model)\b/i;
const REVIEW_RE = /\b(review|beoordeel|nakijken|inspecteer)\b/i;
const TEST_RE = /\b(tests?|testen|unit tests?|coverage|e2e)\b/i;
const DOC_RE =
  /\b(documentation|documentatie|readme|docs|documenteer|document)\b/i;
const REFACTOR_RE =
  /\b(refactor\w*|herstructureer\w*|opschonen|clean up|rename|hernoem\w*|reorganize|reorganiseer)\b/i;
const FEATURE_RE =
  /\b(implement\w*|bouw|build|ontwikkel\w*|create|voeg\b.{0,40}\btoe|add\b|nieuwe? (?:feature|functie|functionaliteit|pagina|page|endpoint)|new (?:feature|page|endpoint|component))\b/i;
const UI_NOUN_RE =
  /\b(\p{L}*(?:pagina|page|card|kaart|knop|button|scherm|screen|formulier|form|menu|navbar|sidebar|modal|dialog|header|footer|tabel|table|dashboard|component|widget|banner|toolbar))\b/iu;
const UI_GENERIC_RE = /\b(ui|interface|gui|frontend|front-end)\b/i;
const CHANGE_VERB_RE =
  /\b(maak|make|verander|change|pas|update|wijzig|modify|zet|set|aanpassen|adjust)\b/i;
const RESEARCH_RE =
  /\b(research|onderzoek\w*|vergelijk\w*|compare|investigate|evaluate opties|zoek uit)\b/i;
const DATA_RE =
  /\b(data[- ]?analy\w+|analyseer (?:de )?data|statistiek\w*|metrics|rapportage|dataset)\b/i;
const PM_RE =
  /\b(plan(?:ning)?|roadmap|prioriteer\w*|status update|taken verdelen|sprint|backlog)\b/i;
const CONFIG_RE =
  /\b(config\w*|configuratie|instellingen|settings|environment variable|omgevingsvariabele)\b/i;
const AUTH_TARGET_RE =
  /\b(login|inlog\w*|auth\w*|password|wachtwoord|token|session|sessie|permission|rechten|rol|role)\b/i;
const PROD_RE = /\b(production|productie|prod)\b/i;
const BACKEND_RE =
  /\b(api|endpoint|backend|server|database|firestore|service|functie op de server)\b/i;
const GITHUB_RE = /\b(github|git|pull request|\bpr\b|commit|branch)\b/i;
const FIREBASE_RE = /\b(firebase|hosting|cloud functions?)\b/i;

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function tokens(text: string): string[] {
  return text.toLowerCase().match(/\p{L}[\p{L}\p{N}_-]*/gu) ?? [];
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function detectLanguage(words: readonly string[]): "nl" | "en" | "unknown" {
  let nl = 0;
  let en = 0;
  for (const word of words) {
    if (DUTCH_MARKERS.has(word)) nl += 1;
    if (ENGLISH_MARKERS.has(word)) en += 1;
  }
  if (nl === 0 && en === 0) return "unknown";
  return nl >= en ? (nl === en ? "en" : "nl") : "en";
}

function projectNames(candidate: ProjectCandidate): string[] {
  const names = new Set<string>();
  const add = (value: string | undefined): void => {
    const v = value?.trim();
    if (v && v.length >= 3) names.add(v);
  };
  add(candidate.displayName);
  add(candidate.projectId);
  add(candidate.projectId.replace(/[-_]+/g, " "));
  add(candidate.code);
  return [...names];
}

function resolveProject(input: IntentAnalyzerInput): ProjectResolution {
  if (input.explicitProjectId) {
    const found = input.projects.find(
      (p) => p.projectId === input.explicitProjectId,
    );
    if (found) {
      return {
        projectId: found.projectId,
        displayName: found.displayName,
        via: "explicit",
        candidates: [found.projectId],
      };
    }
    // Explicit but not accessible/known: say nothing about why (no probing).
    return { via: "none", candidates: [] };
  }
  // Find every occurrence of every candidate's names, then drop a candidate
  // whose occurrences all sit INSIDE a longer candidate's occurrence ("AI"
  // inside "AI Workforce"). Two genuinely different projects stay ambiguous.
  interface Span {
    start: number;
    end: number;
    projectId: string;
  }
  const spans: Span[] = [];
  for (const candidate of input.projects) {
    for (const name of projectNames(candidate)) {
      const pattern = new RegExp(
        `(?<![\\p{L}\\p{N}])${escapeRegExp(name)}(?![\\p{L}\\p{N}])`,
        "giu",
      );
      for (const m of input.request.matchAll(pattern)) {
        spans.push({
          start: m.index,
          end: m.index + m[0].length,
          projectId: candidate.projectId,
        });
      }
    }
  }
  const alive = new Set<string>();
  for (const span of spans) {
    const covered = spans.some(
      (other) =>
        other.projectId !== span.projectId &&
        other.start <= span.start &&
        other.end >= span.end &&
        other.end - other.start > span.end - span.start,
    );
    if (!covered) alive.add(span.projectId);
  }
  const matches = input.projects.filter((p) => alive.has(p.projectId));
  if (matches.length === 1) {
    const only = matches[0]!;
    return {
      projectId: only.projectId,
      displayName: only.displayName,
      via: "mention",
      candidates: [only.projectId],
    };
  }
  return { via: "none", candidates: matches.map((m) => m.projectId) };
}

/* ---- target / operation ------------------------------------------------ */

const NOUN_SUFFIXES = [
  "pagina",
  "page",
  "card",
  "kaart",
  "knop",
  "button",
  "scherm",
  "screen",
  "formulier",
  "form",
  "menu",
  "navbar",
  "sidebar",
  "modal",
  "dialog",
  "header",
  "footer",
  "tabel",
  "table",
  "dashboard",
  "component",
  "widget",
  "banner",
  "toolbar",
];

function extractUiTarget(
  request: string,
  project?: ProjectResolution,
): string | undefined {
  const words = request.match(/\p{L}[\p{L}\p{N}_'-]*/gu) ?? [];
  const projectWords = new Set(
    (project?.displayName ? tokens(project.displayName) : []).concat(
      project?.projectId ? tokens(project.projectId.replace(/-/g, " ")) : [],
    ),
  );
  for (let i = 0; i < words.length; i++) {
    const lower = words[i]!.toLowerCase();
    const suffix = NOUN_SUFFIXES.find((s) => lower.endsWith(s));
    if (!suffix) continue;
    if (lower.length > suffix.length) return lower; // compound: "loginpagina"
    const parts = [lower];
    for (let j = i - 1; j >= 0 && parts.length < 3; j--) {
      const prev = words[j]!.toLowerCase();
      if (STOP.has(prev) || ACTION_WORDS.has(prev) || projectWords.has(prev))
        break;
      parts.unshift(prev);
    }
    return parts.join(" ");
  }
  const themeMatch =
    /\b(dark|light|donkere?|lichte?)\s+(theme|thema|mode|modus)\b/i.exec(
      request,
    );
  if (themeMatch) return themeMatch[0].toLowerCase();
  return undefined;
}

interface ChangeShape {
  operation?: string;
  scope?: string;
  direction?: "reduce" | "increase";
  vertical: boolean;
  horizontal: boolean;
  defaulted: boolean;
}

function analyzeStyleChange(
  request: string,
  target: string | undefined,
): ChangeShape {
  const lower = request.toLowerCase();
  const reduce =
    /\b(compacter|compact|tighter|smaller|kleiner|narrower|minder|less|verklein\w*|shrink|reduce|verlaag\w*|lower|shorter|korter)\b/.test(
      lower,
    );
  const increase =
    /\b(breder|bredere|wider|groter|bigger|larger|meer|more|vergroot\w*|increase|taller|hoger|verhoog\w*)\b/.test(
      lower,
    );
  const vertical =
    /\b(boven en beneden|bovenaan en onderaan|top (?:and|&) bottom|vertical(?:ly)?|verticaal|hoogte|height|hoger|lager|taller|shorter|korter)\b/.test(
      lower,
    );
  const horizontal =
    /\b(links en rechts|left (?:and|&) right|horizontal(?:ly)?|horizontaal|breedte|width|breder|wider|narrower|smalle?r van links)\b/.test(
      lower,
    );
  const direction: ChangeShape["direction"] = reduce
    ? "reduce"
    : increase
      ? "increase"
      : undefined;
  const subject = target ?? "the target";

  let scope: string | undefined;
  let defaulted = false;
  if (vertical && !horizontal) scope = "vertical dimensions/padding";
  else if (horizontal && !vertical) scope = "horizontal dimensions/padding";
  else if (vertical && horizontal)
    scope = "vertical and horizontal dimensions/padding";
  else if (
    direction !== undefined &&
    /\b(compacter|compact|tighter|minder ruimte|less spacing)\b/.test(lower)
  ) {
    scope = "vertical spacing/padding";
    defaulted = true;
  } else if (/\b(kleur(?:en)?|colou?rs?)\b/.test(lower)) scope = "colors";
  else if (/\b(font|lettertype)\b/.test(lower)) scope = "typography";
  else if (/\b(schaduw|shadow)\b/.test(lower)) scope = "shadows";
  else if (/\b(border|rand)\b/.test(lower)) scope = "borders";
  else if (/\b(animatie|animation)\b/.test(lower)) scope = "animation";
  else if (/\b(padding|margin|spacing|ruimte|witruimte|gap)\b/.test(lower))
    scope = "spacing/padding";
  else if (/\b(layout)\b/.test(lower)) scope = "layout";

  const verb =
    direction === "reduce"
      ? "Reduce"
      : direction === "increase"
        ? "Increase"
        : "Adjust";
  const operation = scope ? `${verb} ${scope} of ${subject}` : undefined;
  return {
    operation,
    scope,
    direction,
    vertical: vertical || defaulted,
    horizontal,
    defaulted,
  };
}

/**
 * For prose-described work ("the permission error when creating code groups")
 * the target is the object phrase of the request: leading action words, the
 * project mention and trailing constraint clauses are stripped. It is a
 * description, not a file — and is reported as such.
 */
function extractProseTarget(
  request: string,
  project: ProjectResolution,
): string | undefined {
  let text = request.split(/[.!?](?:\s|$)/)[0] ?? request;
  const names = [project.displayName, project.projectId].filter(
    (n): n is string => Boolean(n),
  );
  for (const name of names) {
    text = text.replace(
      new RegExp(escapeRegExp(name) + "(?:\\s+OS)?", "ig"),
      " ",
    );
  }
  text = text
    .replace(
      /\b(?:without|zonder|but|maar|while|terwijl|and keep|en behoud)\b.*$/i,
      " ",
    )
    .replace(
      /^\s*(?:please\s+|graag\s+)?(?:analy[sz]e|fix|repair|solve|los|repareer|implement|build|bouw|add|voeg|refactor|ontwikkel)\b/i,
      " ",
    )
    .replace(/\b(?:and|en)\s+(?:fix|repair|solve|los)\b.*$/i, " ")
    .replace(/\s+/g, " ")
    .replace(/^(?:the|de|het|een|a|an)\s+/i, "")
    .trim();
  const meaningful = text
    .split(" ")
    .filter((w) => w.length >= 3 && !STOP.has(w.toLowerCase()));
  return meaningful.length >= 2 ? text.slice(0, 80) : undefined;
}

/* ---- explicit constraints ---------------------------------------------- */

function clean(fragment: string): string {
  return fragment
    .replace(/\s+/g, " ")
    .replace(/^[\s,;:-]+|[\s,;:.!-]+$/g, "")
    .slice(0, 100);
}

const DEGRADE: Readonly<Record<string, string>> = {
  weakening: "weaken",
  compromising: "compromise",
  reducing: "reduce",
  degrading: "degrade",
  lowering: "lower",
};

export function extractExplicitConstraints(request: string): string[] {
  const out: string[] = [];
  const add = (text: string): void => {
    const t = text.slice(0, 160);
    if (!out.includes(t)) out.push(t);
  };
  if (
    /\b(verander|wijzig|pas|raak|change|modify|touch|alter)\s+(niets|nothing|geen enkel)\s+(anders|else)\b/i.test(
      request,
    ) ||
    /\b(don'?t|do not|never)\s+(change|modify|touch|alter)\s+anything\s+else\b/i.test(
      request,
    ) ||
    /\bnothing else\b/i.test(request)
  ) {
    add("Change nothing other than the requested change.");
  }
  const rules: ReadonlyArray<
    readonly [RegExp, (m: RegExpExecArray) => string]
  > = [
    [
      /\b(?:don'?t|do not|never)\s+(?:change|modify|touch|alter)\s+(?!anything else)([^,.;]{2,60})/i,
      (m) => `Do not change ${clean(m[1]!)}.`,
    ],
    [
      /\b(?:verander|wijzig|raak)\s+(?!niets)([^,.;]{2,60}?)\s+niet(?:\s+aan)?\b/i,
      (m) => `Do not change ${clean(m[1]!)}.`,
    ],
    [
      /\b(?:only|alleen|uitsluitend|enkel)\s+([^,.;]{2,60})/i,
      (m) => `Only ${clean(m[1]!)}.`,
    ],
    [
      /\b(?:keep|behoud|houd|bewaar|preserve)\s+([^,.;]{2,60})/i,
      (m) => `Preserve ${clean(m[1]!)}.`,
    ],
    [
      /\bzonder\s+([^,.;]{2,50}?)\s+te\s+(?:veranderen|wijzigen|raken|breken)\b/i,
      (m) => `Do not change or break ${clean(m[1]!)}.`,
    ],
    [
      /\bwithout\s+(?:changing|breaking|touching|modifying)\s+([^,.;]{2,50})/i,
      (m) => `Do not change or break ${clean(m[1]!)}.`,
    ],
    [
      /\bwithout\s+(weakening|compromising|reducing|degrading|lowering)\s+([^,.;]{2,50})/i,
      (m) => `Do not ${DEGRADE[m[1]!.toLowerCase()]} ${clean(m[2]!)}.`,
    ],
    [
      /\b(?:except|behalve)\s+([^,.;]{2,60})/i,
      (m) => `Except ${clean(m[1]!)}.`,
    ],
  ];
  for (const [pattern, build] of rules) {
    const match = pattern.exec(request);
    if (match) add(build(match));
    if (out.length >= 8) break;
  }
  return out;
}

/* ---- classification ---------------------------------------------------- */

function classify(request: string, hasDestructive: boolean): IntentCategory {
  if (hasDestructive) return "DESTRUCTIVE_OPERATION";
  if (THEME_RE.test(request)) return "THEME_MODIFICATION";
  if (BUG_RE.test(request)) return "BUG_FIX";
  if (DEPLOY_RE.test(request)) return "DEPLOYMENT";
  if (SECURITY_RE.test(request)) return "SECURITY_REVIEW";
  if (STYLE_RE.test(request)) return "UI_MODIFICATION";
  if (REVIEW_RE.test(request)) return "CODE_REVIEW";
  if (TEST_RE.test(request)) return "TESTING";
  if (DOC_RE.test(request)) return "DOCUMENTATION";
  if (REFACTOR_RE.test(request)) return "REFACTOR";
  if (FEATURE_RE.test(request)) return "FEATURE_IMPLEMENTATION";
  if (
    (UI_NOUN_RE.test(request) || UI_GENERIC_RE.test(request)) &&
    CHANGE_VERB_RE.test(request)
  ) {
    return "UI_MODIFICATION";
  }
  if (RESEARCH_RE.test(request)) return "RESEARCH";
  if (DATA_RE.test(request)) return "DATA_ANALYSIS";
  if (PM_RE.test(request)) return "PROJECT_MANAGEMENT";
  if (CONFIG_RE.test(request)) return "CONFIGURATION";
  return "UNKNOWN";
}

function capability(
  id: string,
  role: RequiredCapability["role"],
  reason: string,
): RequiredCapability {
  const canonical = canonicalizeCapability(id);
  if (canonical === undefined) {
    // A programming error in this table, caught by the test suite.
    throw new Error(`prompt intelligence: unknown capability ${id}`);
  }
  return { capability: canonical, role, reason };
}

function capabilitiesFor(
  category: IntentCategory,
  request: string,
  risk: RiskLevel,
  destructiveKinds: readonly string[],
): RequiredCapability[] {
  const caps: RequiredCapability[] = [];
  const add = (c: RequiredCapability): void => {
    if (!caps.some((x) => x.capability === c.capability)) caps.push(c);
  };
  const backendish = BACKEND_RE.test(request);
  switch (category) {
    case "UI_MODIFICATION":
      add(
        capability("software.frontend", "primary", "Implements the UI change."),
      );
      add(
        capability(
          "design.ui",
          "supporting",
          "Keeps the change consistent with the design system.",
        ),
      );
      add(
        capability(
          "software.testing",
          "verification",
          "Runs tests and the build.",
        ),
      );
      break;
    case "THEME_MODIFICATION":
      add(capability("design.ui", "primary", "Owns the visual theme."));
      add(
        capability(
          "software.frontend",
          "supporting",
          "Implements the theme in code.",
        ),
      );
      add(
        capability(
          "software.testing",
          "verification",
          "Runs tests and the build.",
        ),
      );
      add(
        capability(
          "software.review",
          "verification",
          "Independent review of a broad visual change.",
        ),
      );
      break;
    case "FEATURE_IMPLEMENTATION":
      add(
        capability(
          backendish
            ? "software.backend"
            : UI_NOUN_RE.test(request)
              ? "software.frontend"
              : "software.general",
          "primary",
          "Implements the feature.",
        ),
      );
      add(capability("software.testing", "verification", "Tests the feature."));
      add(capability("software.review", "verification", "Independent review."));
      break;
    case "BUG_FIX":
      add(
        capability(
          backendish
            ? "software.backend"
            : UI_NOUN_RE.test(request) || STYLE_RE.test(request)
              ? "software.frontend"
              : "software.general",
          "primary",
          "Diagnoses and fixes the defect.",
        ),
      );
      add(
        capability(
          "software.testing",
          "verification",
          "Proves the fix and guards against regression.",
        ),
      );
      break;
    case "REFACTOR":
      add(
        capability(
          "software.general",
          "primary",
          "Restructures code without changing behaviour.",
        ),
      );
      add(
        capability(
          "software.testing",
          "verification",
          "Behaviour must be unchanged.",
        ),
      );
      add(capability("software.review", "verification", "Independent review."));
      break;
    case "TESTING":
      add(capability("software.testing", "primary", "Authors or runs tests."));
      break;
    case "CODE_REVIEW":
      add(capability("software.review", "primary", "Reviews the change."));
      break;
    case "SECURITY_REVIEW":
      add(capability("software.security", "primary", "Security analysis."));
      break;
    case "DEPLOYMENT":
      add(
        capability(
          FIREBASE_RE.test(request) ? "deployment.firebase" : "deployment",
          "primary",
          "Builds and releases.",
        ),
      );
      add(
        capability(
          "software.testing",
          "verification",
          "Verifies before release.",
        ),
      );
      add(capability("software.security", "verification", "Release gate."));
      break;
    case "DOCUMENTATION":
      add(
        capability(
          "software.general",
          "primary",
          "Writes or updates documentation.",
        ),
      );
      break;
    case "RESEARCH":
      add(capability("research", "primary", "Research and synthesis."));
      break;
    case "DATA_ANALYSIS":
      add(capability("data", "primary", "Data analysis."));
      break;
    case "PROJECT_MANAGEMENT":
      add(
        capability(
          "project.management",
          "primary",
          "Planning and coordination.",
        ),
      );
      break;
    case "CONFIGURATION":
      add(capability("software.general", "primary", "Changes configuration."));
      add(
        capability(
          "software.security",
          "supporting",
          "Configuration can be security-relevant.",
        ),
      );
      break;
    case "DESTRUCTIVE_OPERATION":
      add(
        capability(
          destructiveKinds.includes("repository_deletion") ||
            destructiveKinds.includes("history_rewrite")
            ? "integration.github"
            : destructiveKinds.length === 1 &&
                destructiveKinds[0] === "environment_deletion"
              ? "deployment"
              : "software.general",
          "primary",
          "Performs the requested destructive operation ONLY after human approval.",
        ),
      );
      add(
        capability(
          "software.security",
          "supporting",
          "Reviews the blast radius.",
        ),
      );
      add(
        capability(
          "software.review",
          "verification",
          "Independent review before execution.",
        ),
      );
      break;
    case "UNKNOWN":
      add(
        capability(
          "project.management",
          "primary",
          "Clarify and decompose the objective first.",
        ),
      );
      break;
  }
  if (
    GITHUB_RE.test(request) &&
    !caps.some((c) => c.capability === "integration.github")
  ) {
    add(
      capability(
        "integration.github",
        "supporting",
        "The request involves source control.",
      ),
    );
  }
  if (
    risk === "high" &&
    !caps.some((c) => c.capability === "software.security")
  ) {
    add(capability("software.security", "verification", "High-risk request."));
  }
  return caps;
}

const EXPECTED_OUTPUT: Readonly<Record<IntentCategory, string>> = {
  UI_MODIFICATION:
    "A code change limited to the requested scope, with test/build evidence and a list of changed files.",
  THEME_MODIFICATION:
    "The theme replaced across the application, with test/build evidence and a list of changed files.",
  FEATURE_IMPLEMENTATION:
    "The feature implemented with tests, build evidence and a list of changed files.",
  BUG_FIX:
    "The root cause fixed with a regression test, build evidence and a list of changed files.",
  REFACTOR:
    "Restructured code with unchanged behaviour, passing tests and a list of changed files.",
  TESTING: "New or updated tests with their results.",
  CODE_REVIEW: "A written review with findings classified by severity.",
  SECURITY_REVIEW: "A security review with findings classified by severity.",
  DEPLOYMENT: "A verified deployment with its health evidence.",
  DOCUMENTATION: "Updated documentation and a list of changed files.",
  RESEARCH: "A sourced research summary with a recommendation.",
  DATA_ANALYSIS: "An analysis with the method, data used and conclusions.",
  PROJECT_MANAGEMENT: "A plan with milestones, owners and risks.",
  CONFIGURATION: "The configuration change with verification evidence.",
  DESTRUCTIVE_OPERATION:
    "Nothing is executed until a human approves; then the approved operation with an audit trail.",
  UNKNOWN: "A clarified objective.",
};

function keywordsOf(
  request: string,
  target: string | undefined,
  project: ProjectResolution,
): string[] {
  // The project's own name matches every fact about the project, so it carries
  // no relevance signal: leave it out.
  const own = new Set(
    tokens(
      `${project.displayName ?? ""} ${(project.projectId ?? "").replace(/-/g, " ")}`,
    ),
  );
  const words = tokens(`${request} ${target ?? ""}`).filter(
    (w) => w.length >= 3 && !STOP.has(w) && !ACTION_WORDS.has(w) && !own.has(w),
  );
  const unique = [...new Set(words)].slice(0, 12);
  const expanded = new Set(unique);
  for (const word of unique) {
    for (const synonym of SYNONYMS[word] ?? []) expanded.add(synonym);
  }
  return [...expanded].slice(0, 24);
}

/* ------------------------------------------------------------------ */
/* Analyzer                                                           */
/* ------------------------------------------------------------------ */

export class RuleBasedIntentAnalyzer implements IntentAnalyzer {
  analyze(input: IntentAnalyzerInput): IntentAnalysis {
    const request = input.request.replace(/\s+/g, " ").trim();
    const words = tokens(request);
    const project = resolveProject({ ...input, request });
    const destructive = detectDestructive(request);
    const securityOverrideAttempts = detectSecurityOverrides(request);
    const category = classify(request, destructive.length > 0);
    const ambiguity: AmbiguityIssue[] = [];

    let target: string | undefined;
    let operation: string | undefined;
    let scope: string | undefined;
    let change: ChangeShape | undefined;
    switch (category) {
      case "UI_MODIFICATION": {
        target = extractUiTarget(request, project);
        change = analyzeStyleChange(request, target);
        operation = change.operation;
        scope = change.scope;
        break;
      }
      case "THEME_MODIFICATION": {
        target = extractUiTarget(request, project);
        const to =
          /\b(?:naar|to|met|with)\s+(?:de |het |the )?(?:nieuwe |new )?([\p{L}\p{N} -]{3,40}?)\s*(?:theme|thema)\b/iu.exec(
            request,
          );
        operation = to
          ? `Replace ${target ?? "the theme"} with the ${clean(to[1]!)} theme`
          : `Modify ${target ?? "the theme"}`;
        scope = target;
        break;
      }
      case "BUG_FIX":
      case "REFACTOR":
      case "FEATURE_IMPLEMENTATION":
        target =
          extractUiTarget(request, project) ??
          extractProseTarget(request, project);
        break;
      default:
        break;
    }

    if (category === "DESTRUCTIVE_OPERATION") {
      target = destructive.map((d) => d.matched).join("; ");
      operation = `Destructive operation: ${destructive.map((d) => d.kind).join(", ")}`;
    }

    // ---- ambiguity --------------------------------------------------
    if (words.length < 3) {
      ambiguity.push({
        code: "request_too_short",
        severity: "high",
        message: "The request is too short to act on.",
      });
    }
    if (project.projectId === undefined) {
      ambiguity.push(
        project.candidates.length > 1
          ? {
              code: "project_ambiguous",
              severity: "high",
              message: "The request matches more than one project; choose one.",
            }
          : {
              code: "project_unresolved",
              severity: "high",
              message: "No project could be identified; select a project.",
            },
      );
    }
    if (category === "UNKNOWN") {
      ambiguity.push({
        code: "intent_unclear",
        severity: "high",
        message: "The intent of the request could not be determined.",
      });
    }
    if (
      (category === "UI_MODIFICATION" ||
        category === "BUG_FIX" ||
        category === "REFACTOR") &&
      target === undefined
    ) {
      ambiguity.push({
        code: "target_unidentified",
        severity: "high",
        message: "The target of the change could not be identified.",
      });
    }
    if (
      /\b(alles|everything|all of it|overal|everywhere)\b/i.test(request) &&
      CHANGE_VERB_RE.test(request)
    ) {
      ambiguity.push({
        code: "scope_unbounded",
        severity: "high",
        message:
          "The scope ('everything') is unbounded; name what should change.",
      });
    }
    if (category === "UI_MODIFICATION" && change) {
      if (change.operation === undefined) {
        ambiguity.push({
          code: "operation_unspecified",
          severity: "high",
          message: "What should change about the target was not specified.",
        });
      } else if (change.defaulted) {
        ambiguity.push({
          code: "axis_unspecified",
          severity: "low",
          message: "No axis was given for 'more compact'.",
          appliedDefault:
            "Reduce vertical spacing/padding only; keep horizontal layout unchanged.",
        });
      } else if (change.direction === undefined) {
        ambiguity.push({
          code: "magnitude_unspecified",
          severity: "low",
          message: "No target value or direction was given.",
          appliedDefault:
            "Use the project's design-system spacing/size tokens; do not introduce new values.",
        });
      }
    }

    // ---- constraints ------------------------------------------------
    const explicitConstraints = extractExplicitConstraints(request);
    const strict = explicitConstraints.some((c) =>
      c.startsWith("Change nothing other"),
    );
    const implied: string[] = [];
    const imply = (text: string): void => {
      if (!implied.includes(text) && !explicitConstraints.includes(text))
        implied.push(text);
    };
    switch (category) {
      case "UI_MODIFICATION":
        imply("Preserve existing functionality.");
        imply("Do not modify unrelated components.");
        imply("Preserve responsive behavior.");
        if (change?.vertical && !change.horizontal)
          imply("Preserve horizontal dimensions and layout.");
        if (change?.horizontal && !change.vertical)
          imply("Preserve vertical dimensions and layout.");
        if (
          strict ||
          scope?.includes("dimensions") ||
          scope?.includes("spacing")
        ) {
          imply("Preserve colors.");
          imply("Preserve typography.");
        }
        if (target && AUTH_TARGET_RE.test(target))
          imply("Preserve authentication functionality.");
        break;
      case "THEME_MODIFICATION":
        imply(
          /\bdark|donker/i.test(request)
            ? "Preserve the light theme."
            : "Preserve the dark theme.",
        );
        imply("Preserve existing functionality.");
        imply("Preserve component structure unless a change is necessary.");
        break;
      case "BUG_FIX":
        imply("Fix the root cause, not the symptom.");
        imply("Do not weaken any security control.");
        imply("Do not modify unrelated code.");
        break;
      case "REFACTOR":
        imply("Behaviour must not change.");
        imply("Do not modify unrelated code.");
        break;
      case "FEATURE_IMPLEMENTATION":
        imply("Follow existing repository conventions.");
        imply("Do not modify unrelated code.");
        break;
      case "DEPLOYMENT":
        imply("Deploy only the resources affected by this change.");
        imply("Verify the deployment before reporting success.");
        break;
      default:
        break;
    }
    if (strict)
      imply(
        "Modify only what the request names; touch no other file, style, or behaviour.",
      );

    // ---- risk -------------------------------------------------------
    const risks: string[] = [];
    let risk: RiskLevel = "low";
    const raise = (level: RiskLevel, why: string): void => {
      risks.push(why);
      if (level === "high" || (level === "medium" && risk === "low"))
        risk = level;
    };
    if (destructive.length > 0)
      raise(
        "high",
        `Destructive operation requested (${destructive.map((d) => d.kind).join(", ")}).`,
      );
    if (securityOverrideAttempts.length > 0)
      raise("high", "The request tries to weaken a security requirement.");
    if (category === "THEME_MODIFICATION")
      raise("medium", "A theme change touches many components.");
    if (category === "DEPLOYMENT")
      raise(
        PROD_RE.test(request) ? "high" : "medium",
        PROD_RE.test(request)
          ? "Production deployment."
          : "Deployment changes a live environment.",
      );
    if (category === "CONFIGURATION")
      raise(
        "medium",
        "Configuration changes can affect behaviour and security.",
      );
    if (target && AUTH_TARGET_RE.test(target) && category !== "UI_MODIFICATION")
      raise("medium", "The target is an authentication surface.");
    if (target && AUTH_TARGET_RE.test(target) && category === "UI_MODIFICATION")
      risks.push(
        "Touches an authentication surface; functionality must be preserved.",
      );
    if (ambiguity.some((a) => a.severity === "high"))
      risks.push(
        "High ambiguity: the request cannot be acted on safely as written.",
      );

    // ---- objective + capabilities ----------------------------------
    const subject = project.displayName ?? "the project";
    const objective =
      operation !== undefined
        ? `${operation} (${subject}).`
        : request.length > 200
          ? `${request.slice(0, 197)}...`
          : request;
    const requiredCapabilities = capabilitiesFor(
      category,
      request,
      risk,
      destructive.map((d) => d.kind),
    );

    return {
      language: detectLanguage(words),
      category,
      objective,
      project,
      ...(target !== undefined ? { target } : {}),
      ...(operation !== undefined ? { operation } : {}),
      ...(scope !== undefined ? { scope } : {}),
      explicitConstraints,
      impliedConstraints: implied,
      expectedOutput: EXPECTED_OUTPUT[category],
      risk,
      risks,
      requiredCapabilities,
      ambiguity,
      destructive,
      securityOverrideAttempts,
      keywords: keywordsOf(request, target, project),
      analyzer: "rules-v1",
    };
  }
}
