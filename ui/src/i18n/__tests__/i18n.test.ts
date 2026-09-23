import { afterEach, describe, expect, it, vi } from "vitest";
import { en } from "../locales/en";
import { nl } from "../locales/nl";
import { LANGUAGE_STORAGE_KEY, detectLanguage, isLanguage } from "../languages";
import { translate, type MessageKey } from "../messages";

function leafPaths(node: unknown, prefix = ""): string[] {
  if (typeof node === "string") return [prefix];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    leafPaths(value, prefix ? `${prefix}.${key}` : key),
  );
}

describe("locale catalogues", () => {
  it("Dutch covers every English key, with no empty values", () => {
    const enKeys = leafPaths(en).sort();
    const nlKeys = leafPaths(nl).sort();
    expect(nlKeys).toEqual(enKeys);
    for (const key of nlKeys) {
      expect(translate("nl", key as MessageKey).trim().length, key).toBeGreaterThan(0);
    }
  });

  it("keeps placeholders consistent between languages", () => {
    for (const key of leafPaths(en)) {
      const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();
      expect(placeholders(translate("nl", key as MessageKey)), key).toEqual(
        placeholders(translate("en", key as MessageKey)),
      );
    }
  });

  it("uses the agreed navigation terminology", () => {
    expect(translate("nl", "nav.overview")).toBe("Overzicht");
    expect(translate("nl", "nav.projects")).toBe("Projecten");
    expect(translate("nl", "nav.tasks")).toBe("Taken");
    expect(translate("nl", "nav.approvals")).toBe("Goedkeuringen");
    expect(translate("nl", "nav.knowledge")).toBe("Kennis");
    expect(translate("nl", "nav.settings")).toBe("Instellingen");
    expect(translate("nl", "settings.appearance")).toBe("Weergave");
  });
});

describe("translate", () => {
  it("interpolates parameters", () => {
    expect(translate("en", "workflows.approvalsMany", { count: 3 })).toBe("3 approvals");
    expect(translate("nl", "workflows.approvalsMany", { count: 3 })).toBe("3 goedkeuringen");
  });

  it("falls back to English, then to the key itself — never throws", () => {
    expect(translate("nl", "does.not.exist" as MessageKey)).toBe("does.not.exist");
  });
});

describe("language detection", () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("prefers a saved, allowlisted preference", () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, "nl");
    expect(detectLanguage()).toBe("nl");
  });

  it("ignores values outside the allowlist", () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, "<script>");
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["fr-FR"]);
    expect(detectLanguage()).toBe("en");
    expect(isLanguage("<script>")).toBe(false);
  });

  it("uses a supported browser locale, otherwise English", () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["nl-BE", "en"]);
    expect(detectLanguage()).toBe("nl");
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["de-DE"]);
    expect(detectLanguage()).toBe("en");
  });
});
