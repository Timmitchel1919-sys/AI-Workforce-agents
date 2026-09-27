import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { onboardingEn } from "../../../i18n/locales/onboarding.en";
import { onboardingNl } from "../../../i18n/locales/onboarding.nl";
import { en } from "../../../i18n/locales/en";
import { nl } from "../../../i18n/locales/nl";
import { canProvision, initialStep } from "../lib/steps";
import { suggestCode, validateIdentitySource, validateRepositoryUrl } from "../lib/validation";
import { REVIEW_SESSION, makeSession } from "./fixtures";

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

describe("onboarding locale parity", () => {
  it("EN and NL have identical keys, placeholders and no empty values", () => {
    const enKeys = leaves(onboardingEn).sort();
    expect(leaves(onboardingNl).sort()).toEqual(enKeys);
    const get = (o: unknown, k: string) => k.split(".").reduce<unknown>((a, p) => (a as Record<string, unknown>)[p], o) as string;
    for (const key of enKeys) {
      expect(get(onboardingNl, key).trim().length, key).toBeGreaterThan(0);
      const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
      expect(ph(get(onboardingNl, key)), key).toEqual(ph(get(onboardingEn, key)));
    }
  });

  it("is merged into both catalogues", () => {
    expect(en.onboarding).toBe(onboardingEn);
    expect(nl.onboarding).toBe(onboardingNl);
  });

  it("every literal tt('...') key used in the sources exists", () => {
    const keys = new Set(leaves(onboardingEn));
    const code = [...sources(join(__dirname, "..")), ...sources(join(__dirname, "../../../pages/ProjectOnboarding"))].join("\n");
    const used = [...code.matchAll(/\btt\(\s*"([\w.]+)"/g)].map((m) => m[1] as string);
    expect(used.length).toBeGreaterThan(50);
    for (const key of used) expect(keys.has(key), key).toBe(true);
    for (const m of code.matchAll(/"((?:error|wizard)\.\w+(?:Title|Body))"/g)) expect(keys.has(m[1] as string), m[1]).toBe(true);
  });
});

describe("validation", () => {
  it.each([
    ["https://user:pw@github.com/a/b", "repoCredentials"],
    ["https://ghp_token@github.com/a/b", "repoCredentials"],
    ["http://github.com/a/b", "repoNotHttps"],
    ["", "repoRequired"],
    ["git@github.com:a/b.git", "repoInvalid"],
    ["https://github.com/a/b?token=1", "repoExtras"],
  ])("rejects %s", (url, expected) => {
    expect(validateRepositoryUrl(url)).toBe(expected);
  });

  it("accepts a plain https repository", () => {
    expect(validateRepositoryUrl("https://github.com/acme/app")).toBeUndefined();
  });

  it("validates identity and source per kind", () => {
    expect(validateIdentitySource("import_existing", { name: "A", code: "x" }, {})).toMatchObject({ name: "nameRequired", code: "codeInvalid", repositoryUrl: "repoRequired" });
    expect(validateIdentitySource("create_new", { name: "Acme", code: "ACME" }, { specification: "short" })).toMatchObject({ specification: "specRequired" });
  });

  it("suggests upper-case codes", () => {
    expect(suggestCode("Money Mind")).toBe("MONEYM");
    expect(suggestCode("acme")).toBe("ACME");
    expect(suggestCode("9 lives")).toMatch(/^[A-Z]/);
  });
});

describe("step derivation", () => {
  it("resumes at the step implied by the status", () => {
    expect(initialStep(makeSession())).toBe("identity");
    expect(initialStep(makeSession({ status: "analyzed" }))).toBe("analyze");
    expect(initialStep(REVIEW_SESSION)).toBe("review");
    expect(initialStep(makeSession({ status: "provisioning" }))).toBe("progress");
    expect(initialStep(makeSession({ mode: "auto" }))).toBe("setup");
  });

  it("only allows provisioning for an approved plan without blockers", () => {
    expect(canProvision(REVIEW_SESSION)).toBe(false);
    expect(canProvision({ ...REVIEW_SESSION, status: "approved" })).toBe(true);
    const blocked = { ...REVIEW_SESSION, status: "approved" as const, plan: { ...REVIEW_SESSION.plan!, blockers: [{ code: "b", message: "m" }] } };
    expect(canProvision(blocked)).toBe(false);
  });
});

describe("layout", () => {
  it("uses no fixed pixel widths in the feature stylesheet", () => {
    const css = readFileSync(join(__dirname, "../onboarding.css"), "utf8");
    expect(css).not.toMatch(/(?<![-\w])width:\s*\d+px/);
    expect(css).toMatch(/overflow-wrap/);
  });
});
