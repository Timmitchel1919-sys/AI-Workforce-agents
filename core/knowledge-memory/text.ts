/**
 * Text utilities for the knowledge index: tokenizing, a small synonym lexicon,
 * character-trigram vectors (the "semantic" signal when no embedding provider is
 * configured), stable hashing and clipping. Deterministic and dependency-free.
 */
import { createHash } from "node:crypto";

const STOP = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "to",
  "in",
  "on",
  "for",
  "is",
  "are",
  "was",
  "were",
  "be",
  "it",
  "this",
  "that",
  "with",
  "as",
  "by",
  "at",
  "from",
  "how",
  "does",
  "do",
  "did",
  "what",
  "which",
  "who",
  "my",
  "our",
  "we",
  "i",
  "you",
  "can",
  "should",
  "must",
  "will",
  "de",
  "het",
  "een",
  "en",
  "van",
  "in",
  "op",
  "voor",
  "is",
  "zijn",
  "met",
  "dat",
  "dit",
  "hoe",
  "wat",
  "te",
  "om",
  "naar",
  "bij",
]);

/** Terms that mean roughly the same thing in this domain (query expansion). */
const SYNONYM_GROUPS: readonly (readonly string[])[] = [
  [
    "auth",
    "authentication",
    "login",
    "signin",
    "sign",
    "password",
    "session",
    "oauth",
    "credentials",
  ],
  [
    "ui",
    "ux",
    "design",
    "theme",
    "style",
    "styling",
    "css",
    "padding",
    "spacing",
    "layout",
    "card",
    "glass",
    "navy",
  ],
  ["deploy", "deployment", "hosting", "release", "publish", "firebase"],
  ["test", "tests", "testing", "vitest", "spec", "coverage"],
  ["build", "vite", "bundle", "compile", "typecheck", "typescript", "tsc"],
  ["database", "firestore", "data", "storage", "store", "sheets"],
  [
    "security",
    "secret",
    "secrets",
    "token",
    "permission",
    "authorization",
    "rbac",
  ],
  ["inventory", "asset", "assets", "stock"],
];

const GROUP_OF = new Map<string, number[]>();
SYNONYM_GROUPS.forEach((group, index) => {
  for (const term of group) {
    const list = GROUP_OF.get(term) ?? [];
    list.push(index);
    GROUP_OF.set(term, list);
  }
});

export function stem(token: string): string {
  let t = token;
  if (t.length > 5 && t.endsWith("ing")) t = t.slice(0, -3);
  else if (t.length > 4 && t.endsWith("ies")) t = `${t.slice(0, -3)}y`;
  else if (t.length > 4 && t.endsWith("es")) t = t.slice(0, -2);
  else if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss"))
    t = t.slice(0, -1);
  else if (t.length > 4 && t.endsWith("ed")) t = t.slice(0, -2);
  return t;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_./-]+/g, " ")
    .split(/\s+/)
    .flatMap((t) =>
      t.includes("/") || t.includes(".") ? [t, ...t.split(/[/.-]+/)] : [t],
    )
    .filter((t) => t.length > 1 && !STOP.has(t))
    .map(stem);
}

/** Query terms with their synonym-group siblings at a lower weight. */
export function expandQuery(tokens: readonly string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of tokens) out.set(t, Math.max(out.get(t) ?? 0, 1));
  for (const t of tokens) {
    for (const g of GROUP_OF.get(t) ?? GROUP_OF.get(stem(t)) ?? []) {
      for (const sibling of SYNONYM_GROUPS[g]!) {
        const s = stem(sibling);
        if (!out.has(s)) out.set(s, 0.45);
      }
    }
  }
  return out;
}

export function synonymGroupsOf(tokens: readonly string[]): Set<number> {
  const out = new Set<number>();
  for (const t of tokens) for (const g of GROUP_OF.get(t) ?? []) out.add(g);
  return out;
}

export function trigrams(text: string): Map<string, number> {
  const normalized = ` ${text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
  const out = new Map<string, number>();
  for (let i = 0; i + 3 <= normalized.length; i++) {
    const g = normalized.slice(i, i + 3);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

export function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [, v] of a) na += v * v;
  for (const [, v] of b) nb += v * v;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const [k, v] of small) {
    const w = large.get(k);
    if (w) dot += v * w;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

export function jaccard(
  a: ReadonlySet<string>,
  b: ReadonlySet<string>,
): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export function normalizeForHash(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t && !STOP.has(t))
    .join(" ");
}

export function hashOf(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 32);
}

export function contentHashOf(text: string): string {
  return hashOf(normalizeForHash(text));
}

export function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export function summarize(content: string, max = 220): string {
  const first =
    content
      .replace(/\s+/g, " ")
      .trim()
      .split(/(?<=[.!?])\s/)[0] ?? "";
  return clip(first || content, max);
}

export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
