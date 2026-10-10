/**
 * Destructive-action and security-override detection (Phase 3) — pure rules.
 *
 * Deterministic on purpose: a safety classifier must be explainable and must
 * never be model-assisted. It errs toward flagging; a flag only routes the
 * request to the EXISTING human approval mechanism, it never blocks silently.
 *
 * Dutch and English are both recognised (the operator writes in both).
 */
import type {
  DestructiveFinding,
  DestructiveKind,
} from "../../contracts/prompt-intelligence.js";

const VERBS =
  "delete|deleting|remove|removing|drop|dropping|wipe|wiping|destroy|destroying|purge|purging|erase|erasing|uninstall|nuke|truncate|" +
  "verwijder|verwijderen|verwijdert|wis|wissen|wist|vernietig|vernietigen|leeg|leegmaken|opruimen|weggooien|gooi";

/** Object lexicon → destructive kind. Order matters (first match wins per verb). */
const OBJECTS: ReadonlyArray<readonly [DestructiveKind, string]> = [
  ["repository_deletion", "repositories|repository|repo|repo's|repos"],
  [
    "project_deletion",
    "projects|project|projecten|app|apps|application|applicatie",
  ],
  ["agent_deletion", "agents|agent"],
  ["workflow_deletion", "workflows|workflow"],
  [
    "integration_deletion",
    "integrations|integration|integraties|integratie|connectors|connector|webhooks|webhook",
  ],
  [
    "environment_deletion",
    "environments|environment|omgevingen|omgeving|staging|production|productie",
  ],
  [
    "secret_deletion",
    "secrets|secret|credentials|credential|passwords|password|wachtwoorden|wachtwoord|api keys|api key|keys|key|tokens|token|sleutels|sleutel|geheimen|geheim",
  ],
  [
    "database_destruction",
    "databases|database|db|collections|collection|collecties|collectie|tables|table|tabellen|tabel|firestore|buckets|bucket|records|alle data|all data|data",
  ],
  [
    "configuration_deletion",
    "configs|config|configuration|configuratie|configuraties|settings|instellingen|env file|envfile|\\.env",
  ],
  [
    "file_deletion",
    "files|file|bestanden|bestand|folders|folder|mappen|map|directories|directory|components|component|modules|module|pages|page|pagina|pagina's|routes|route|screens|screen|schermen|scherm|code|tests|test",
  ],
];

/**
 * UI-element words that follow "remove/verwijder" in a purely visual edit
 * ("remove the border"). These are NOT file deletions.
 */
const VISUAL_OBJECTS = new RegExp(
  `\\b(padding|margin|spacing|border|rand|shadow|schaduw|animation|animatie|color|kleur|background|achtergrond|outline|gap|radius|blur|opacity|font|text|tekst|label|icon|icoon|button|knop|link|whitespace|witruimte|line|lijn|underline)\\b`,
  "i",
);

const WORD = "[\\p{L}\\p{N}_.'’-]+";

function compile(kind: DestructiveKind, nouns: string): RegExp {
  return new RegExp(
    `\\b(?:${VERBS})\\b(?:\\s+${WORD}){0,5}?\\s+(?:${nouns})(?![\\p{L}\\p{N}])`,
    "iu",
  );
}

const OBJECT_PATTERNS = OBJECTS.map(
  ([kind, nouns]) => [kind, compile(kind, nouns)] as const,
);

const LITERAL_PATTERNS: ReadonlyArray<readonly [DestructiveKind, RegExp]> = [
  [
    "file_deletion",
    /\brm\s+-[a-z]*r[a-z]*f?\b|\brm\s+-rf\b|\bdel\s+\/[sq]\b|\brmdir\b/i,
  ],
  [
    "database_destruction",
    /\bdrop\s+(?:table|database|schema|collection)\b|\btruncate\s+table\b|\bdelete\s+from\b/i,
  ],
  [
    "history_rewrite",
    /\bgit\s+push\s+(?:--force|-f)\b|\bforce[- ]push\b|\bgit\s+reset\s+--hard\b|\bgit\s+clean\s+-[a-z]*f/i,
  ],
];

/** Detects destructive requests. Bounded, deterministic, secret-free output. */
export function detectDestructive(request: string): DestructiveFinding[] {
  const text = request.slice(0, 4000);
  const findings: DestructiveFinding[] = [];
  const seen = new Set<string>();
  const add = (kind: DestructiveKind, matched: string): void => {
    if (seen.has(kind)) return;
    seen.add(kind);
    findings.push({ kind, matched: matched.trim().slice(0, 120) });
  };

  for (const [kind, pattern] of LITERAL_PATTERNS) {
    const match = pattern.exec(text);
    if (match) add(kind, match[0]);
  }
  for (const [kind, pattern] of OBJECT_PATTERNS) {
    const match = pattern.exec(text);
    if (!match) continue;
    // "remove the padding of the project card" is a visual edit: the verb's
    // direct object is a visual property, even though "project" follows.
    const between = match[0];
    const firstObject = firstWordsAfterVerb(between);
    if (VISUAL_OBJECTS.test(firstObject)) continue;
    add(kind, match[0]);
  }
  return findings;
}

/** The two words right after the destructive verb (the verb's direct object). */
function firstWordsAfterVerb(fragment: string): string {
  const words = fragment.split(/\s+/);
  return words.slice(1, 3).join(" ");
}

/* ------------------------------------------------------------------ */
/* Security override attempts                                         */
/* ------------------------------------------------------------------ */

const SECURITY_NOUNS =
  "authentication|authenticatie|authorization|authorisatie|autorisatie|auth|login check|permissions?|rechten|approvals?|approval gate|goedkeuring(?:en)?|security(?: checks?| rules?)?|beveiliging|audit(?: log(?:ging)?)?|validation|validatie|firestore rules|security rules|rate limit(?:ing)?|csrf|cors|mfa|2fa";

const OVERRIDE_PATTERNS: readonly RegExp[] = [
  new RegExp(
    `\\b(?:skip|disable|bypass|turn off|switch off|circumvent|ignore|omzeil|negeer)\\b(?:\\s+\\p{L}+){0,2}?\\s+(?:the |de |het )?(?:${SECURITY_NOUNS})\\b(?!\\s+(?:test|tests|testing)\\b)`,
    "iu",
  ),
  // Dutch "schakel/zet X uit" (switch X off) — requires the trailing "uit".
  new RegExp(
    `\\b(?:schakel|zet)\\b[^.\\n]{0,30}\\b(?:${SECURITY_NOUNS})\\b[^.\\n]{0,12}\\buit\\b`,
    "iu",
  ),
  new RegExp(
    `\\b(?:remove|delete|drop|verwijder(?:en)?|haal weg|wis)\\b\\s+(?:the |de |het |all |alle )?(?:${SECURITY_NOUNS})\\b`,
    "iu",
  ),
  new RegExp(
    `\\b(?:without|zonder)\\s+(?:the |de |het |any |enige )?(?:${SECURITY_NOUNS})\\b(?!\\s+(?:te|to)\\s+\\p{L}+)`,
    "iu",
  ),
  /\b(?:hard-?code|hardcode|embed|commit|check in|push)\b[^.\n]{0,40}\b(?:secrets?|api[ -]?keys?|passwords?|tokens?|credentials?|wachtwoord|\.env)\b/i,
  /\b(?:expose|leak|print|log|show|toon|lek)\b[^.\n]{0,30}\b(?:secrets?|api[ -]?keys?|passwords?|tokens?|credentials?|wachtwoord)\b/i,
  /\b(?:allow|permit|make)\b[^.\n]{0,20}\b(?:all|everyone|public|iedereen|publiek)\b[^.\n]{0,20}\b(?:access|read|write|toegang)\b/i,
  /\bif\s+true\b.{0,20}\ballow\b|\ballow\s+(?:read|write)[^.\n]{0,20}if\s+true\b/i,
];

/** Instructions that try to weaken a security requirement (never obeyed). */
export function detectSecurityOverrides(request: string): string[] {
  const text = request.slice(0, 4000);
  const out: string[] = [];
  for (const pattern of OVERRIDE_PATTERNS) {
    const match = pattern.exec(text);
    if (match) out.push(match[0].trim().slice(0, 120));
  }
  return [...new Set(out)];
}
