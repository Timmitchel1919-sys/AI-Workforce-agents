import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { en } from "../../../i18n/locales/en";
import { nl } from "../../../i18n/locales/nl";
import { promptIntelligenceEn } from "../../../i18n/locales/promptIntelligence.en";
import { promptIntelligenceNl } from "../../../i18n/locales/promptIntelligence.nl";
import { navigationItems } from "../../../config/navigation";
import {
  APPROVAL_STATES,
  CONTEXT_AUTHORITIES,
  CONTEXT_CATEGORIES,
  CONTEXT_PRECEDENCE,
  DESTRUCTIVE_KINDS,
  EXCLUDED_REASONS,
  INTENT_CATEGORIES,
  VALIDATION_STATUSES,
} from "../types";

function leaves(node: unknown, prefix = ""): string[] {
  if (typeof node === "string") return [prefix];
  return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
}

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "__tests__" ? [] : sources(p);
    return /\.tsx?$/.test(name) ? [readFileSync(p, "utf8")] : [];
  });
}

const get = (o: unknown, k: string) => k.split(".").reduce<unknown>((a, p) => (a as Record<string, unknown>)[p], o) as string;

describe("promptIntelligence locale parity", () => {
  it("EN and NL have identical keys, placeholders and no empty values", () => {
    const enKeys = leaves(promptIntelligenceEn).sort();
    expect(leaves(promptIntelligenceNl).sort()).toEqual(enKeys);
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const key of enKeys) {
      expect(get(promptIntelligenceNl, key).trim().length, key).toBeGreaterThan(0);
      expect(ph(get(promptIntelligenceNl, key)), key).toEqual(ph(get(promptIntelligenceEn, key)));
    }
  });

  it("is merged into both catalogues and the navigation label resolves", () => {
    expect(en.promptIntelligence).toBe(promptIntelligenceEn);
    expect(nl.promptIntelligence).toBe(promptIntelligenceNl);
    expect(navigationItems.some((i) => i.route === "/prompt-intelligence" && i.labelKey === "promptIntelligence.nav")).toBe(true);
  });

  it("every literal tt('...') key used in the sources exists", () => {
    const keys = new Set(leaves(promptIntelligenceEn));
    const code = [...sources(join(__dirname, "..")), ...sources(join(__dirname, "../../../pages/PromptIntelligence"))].join("\n");
    const used = [...code.matchAll(/\btt\(\s*"([\w.]+)"/g)].map((m) => m[1] as string);
    expect(used.length).toBeGreaterThan(80);
    for (const key of used) expect(keys.has(key), key).toBe(true);
    for (const m of code.matchAll(/"(error\.\w+(?:Title|Body))"/g)) expect(keys.has(m[1] as string), m[1]).toBe(true);
  });

  it("labels every backend enum value", () => {
    const groups: [string, readonly string[]][] = [
      ["intentCategory", INTENT_CATEGORIES],
      ["destructive", DESTRUCTIVE_KINDS],
      ["authority", CONTEXT_AUTHORITIES],
      ["precedence", CONTEXT_PRECEDENCE],
      ["contextCategory", CONTEXT_CATEGORIES],
      ["excluded", EXCLUDED_REASONS],
      ["status", VALIDATION_STATUSES],
      ["statusHelp", VALIDATION_STATUSES],
      ["risk", ["low", "medium", "high"]],
      ["language", ["nl", "en", "unknown"]],
      ["sourceStatus", ["ok", "empty", "unavailable"]],
      ["outcome", ["pass", "warn", "fail", "info"]],
      ["role", ["primary", "supporting", "verification"]],
    ];
    const keys = new Set(leaves(promptIntelligenceEn));
    for (const [group, values] of groups) for (const v of values) expect(keys.has(`${group}.${v}`), `${group}.${v}`).toBe(true);
    expect(APPROVAL_STATES.length).toBe(6);
  });
});

describe("stylesheet", () => {
  const css = readFileSync(join(__dirname, "../promptIntelligence.css"), "utf8");

  it("uses theme tokens (dark + light) and no hard-coded colours", () => {
    expect(css).toContain("var(--color-surface)");
    expect(css).toContain("var(--color-text)");
    expect(css).toContain("var(--color-focus)");
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\(/);
  });

  it("has no fixed pixel widths outside media queries (no horizontal overflow)", () => {
    const withoutMedia = css.replace(/@media[^{]*\{/g, "{");
    expect(withoutMedia).not.toMatch(/(?<![-\w])(min-|max-)?width\s*:\s*\d+px/);
  });

  it("respects reduced motion and collapses to one column", () => {
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).toMatch(/\.pi-layout \{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
    expect(css).toMatch(/\.pi-pre \{[^}]*white-space: pre-wrap/);
  });
});
