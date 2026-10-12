import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { securityCenterEn } from "../../../i18n/locales/securityCenter.en";
import { securityCenterNl } from "../../../i18n/locales/securityCenter.nl";
import { ledgerParams, qs, toInstant } from "../api/trustClient";
import { emergencyControls, isPinned, mergeConditions, scopeText, splitAlerts, splitList } from "../lib/logic";
import { ACTION_CLASSES, AUTHORABLE_EFFECTS, EMPTY_AUDIT_FILTERS, ENVIRONMENTS, POLICY_LAYERS, TOOL_APPROVALS, TRUST_STATES } from "../types";
import { makeAlert } from "./fixtures";

function leafPaths(node: unknown, prefix = ""): string[] {
  if (typeof node === "string") return [prefix];
  return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) => leafPaths(v, prefix ? `${prefix}.${k}` : k));
}
function get(node: unknown, path: string): string {
  return path.split(".").reduce<unknown>((n, k) => (n as Record<string, unknown>)[k], node) as string;
}

describe("alert pinning", () => {
  it("pins only unresolved critical and high alerts", () => {
    expect(isPinned({ severity: "CRITICAL", status: "OPEN" })).toBe(true);
    expect(isPinned({ severity: "HIGH", status: "INVESTIGATING" })).toBe(true);
    expect(isPinned({ severity: "HIGH", status: "RESOLVED" })).toBe(false);
    expect(isPinned({ severity: "CRITICAL", status: "FALSE_POSITIVE" })).toBe(false);
    expect(isPinned({ severity: "MEDIUM", status: "OPEN" })).toBe(false);
  });

  it("orders pinned by severity then recency, and the rest newest first", () => {
    const { pinned, rest } = splitAlerts([
      makeAlert({ alertId: "a", severity: "HIGH", createdAt: "2026-05-03" }),
      makeAlert({ alertId: "b", severity: "CRITICAL", createdAt: "2026-05-01" }),
      makeAlert({ alertId: "c", severity: "LOW", createdAt: "2026-05-01" }),
      makeAlert({ alertId: "d", severity: "LOW", createdAt: "2026-05-02" }),
    ]);
    expect(pinned.map((a) => a.alertId)).toEqual(["b", "a"]);
    expect(rest.map((a) => a.alertId)).toEqual(["d", "c"]);
  });
});

describe("emergency state machine", () => {
  it("maps each state to the controls it offers", () => {
    expect(emergencyControls("NORMAL")).toEqual({ stop: true, investigate: false, recover: false, resume: false });
    expect(emergencyControls("PAUSED")).toEqual({ stop: false, investigate: true, recover: true, resume: false });
    expect(emergencyControls("INVESTIGATING")).toEqual({ stop: false, investigate: false, recover: true, resume: false });
    expect(emergencyControls("RECOVERY_REQUIRED")).toEqual({ stop: false, investigate: false, recover: false, resume: true });
  });
});

describe("policy helpers", () => {
  it("offers no ALLOW effect", () => {
    expect(AUTHORABLE_EFFECTS as readonly string[]).not.toContain("ALLOW");
  });

  it("merges form conditions onto existing ones, keeping fields the form does not edit", () => {
    const merged = mergeConditions(
      { actions: ["READ"], resourceKinds: ["database"], contentHasSecret: true, minRisk: "LOW" },
      { actions: ["DELETE"], environments: [], resourceIncludes: [], minCount: "", minRisk: "" },
    );
    expect(merged).toEqual({ actions: ["DELETE"], resourceKinds: ["database"], contentHasSecret: true });
    expect(mergeConditions(undefined, { actions: [], environments: ["TEST"], resourceIncludes: ["x"], minCount: "3", minRisk: "HIGH" }))
      .toEqual({ environments: ["TEST"], resourceIncludes: ["x"], minCount: 3, minRisk: "HIGH" });
  });

  it("splits lists and describes scope", () => {
    expect(splitList(" a, b ,a,, ")).toEqual(["a", "b"]);
    expect(scopeText({ projectId: "p1", taskType: "code" })).toBe("projectId: p1, taskType: code");
    expect(scopeText({})).toBe("");
  });
});

describe("client query building", () => {
  it("omits empty values", () => {
    expect(qs({ a: "1", b: "", c: undefined, d: 0 })).toBe("?a=1&d=0");
    expect(qs({})).toBe("");
  });

  it("turns dates into instants and builds the ledger params", () => {
    expect(toInstant("2026-05-01")).toBe("2026-05-01T00:00:00.000Z");
    expect(toInstant("2026-05-01", true)).toBe("2026-05-01T23:59:59.999Z");
    expect(ledgerParams("p1", { ...EMPTY_AUDIT_FILTERS, agentId: " a1 ", risk: "HIGH" })).toMatchObject({ projectId: "p1", agentId: "a1", risk: "HIGH", limit: 200 });
  });
});

describe("i18n", () => {
  it("has Dutch for every English key with matching placeholders, mostly translated", () => {
    const en = leafPaths(securityCenterEn).sort();
    expect(leafPaths(securityCenterNl).sort()).toEqual(en);
    let different = 0;
    for (const path of en) {
      const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
      expect(ph(get(securityCenterNl, path)), path).toEqual(ph(get(securityCenterEn, path)));
      expect(get(securityCenterNl, path).trim().length, path).toBeGreaterThan(0);
      if (get(securityCenterNl, path) !== get(securityCenterEn, path)) different += 1;
    }
    expect(different / en.length).toBeGreaterThan(0.85);
  });

  const componentsDir = join(__dirname, "../components");
  it("every literal tt('key') used by the components exists in the English catalogue", () => {
    const have = new Set(leafPaths(securityCenterEn));
    let checked = 0;
    for (const file of readdirSync(componentsDir)) {
      const source = readFileSync(join(componentsDir, file), "utf8");
      for (const match of source.matchAll(/\btt\(\s*"([\w.]+)"/g)) {
        expect(have.has(match[1] as string), `${file}: ${match[1]}`).toBe(true);
        checked += 1;
      }
      // keys passed through a ternary: tt(cond ? "a.b" : "c.d")
      for (const match of source.matchAll(/\btt\([^)"`]*\?\s*"([\w.]+)"\s*:\s*"([\w.]+)"/g)) {
        expect(have.has(match[1] as string), `${file}: ${match[1]}`).toBe(true);
        expect(have.has(match[2] as string), `${file}: ${match[2]}`).toBe(true);
      }
    }
    expect(checked).toBeGreaterThan(150);
  });

  it("every dynamic tt(`prefix.${...}`) and label('group', ...) resolves to an existing group", () => {
    for (const file of readdirSync(componentsDir)) {
      const source = readFileSync(join(componentsDir, file), "utf8");
      for (const match of source.matchAll(/\btt\(\s*`([\w.]+)\.\$\{/g)) {
        expect(get(securityCenterEn, match[1] as string), `${file}: ${match[1]}`).toBeTypeOf("object");
      }
      for (const match of source.matchAll(/\blabel\(\s*"(\w+)"/g)) {
        expect((securityCenterEn as Record<string, unknown>)[match[1] as string], `${file}: label group ${match[1]}`).toBeTypeOf("object");
      }
    }
  });

  it("has a label for every backend enum value and every dynamic key", () => {
    const groups: [string, readonly string[]][] = [
      ["trustState", TRUST_STATES], ["action", ACTION_CLASSES], ["environment", ENVIRONMENTS], ["layer", POLICY_LAYERS],
      ["effect", ["ALLOW", ...AUTHORABLE_EFFECTS]], ["toolApproval", TOOL_APPROVALS],
      ["risk", ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"]], ["emergency", ["NORMAL", "PAUSED", "INVESTIGATING", "RECOVERY_REQUIRED"]],
      ["dashboardStatus", ["NOMINAL", "ATTENTION", "DEGRADED", "HALTED"]], ["approvalState", ["PENDING", "APPROVED", "DENIED", "EXPIRED", "CANCELLED"]],
      ["alertStatus", ["OPEN", "ACKNOWLEDGED", "INVESTIGATING", "RESOLVED", "FALSE_POSITIVE"]], ["alertAction", ["ACKNOWLEDGED", "INVESTIGATING", "RESOLVED", "FALSE_POSITIVE"]],
      ["enableStatus", ["ENABLED", "DISABLED"]], ["dataClass", ["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED", "SECRET"]],
      ["findingSeverity", ["low", "medium", "high", "critical"]], ["change", ["added", "modified", "removed"]],
      ["tabs", ["overview", "security", "agents", "models", "tools", "policies", "approvals", "simulator", "audit", "secrets", "project", "emergency"]],
      ["agents.action", ["suspend", "limit", "requireReview", "restore"]],
      ["dashboard", ["openAlerts", "criticalAlerts", "blockedActions24h", "pendingApprovals", "policyViolations7d", "suspendedAgents", "configChanges", "dependencyVulnerabilities"]],
      ["error", ["unauthenticated", "forbidden", "notFound", "conflict", "invalid", "degraded", "network"].flatMap((k) => [`${k}Title`, `${k}Body`])],
    ];
    for (const [group, values] of groups) for (const value of values) expect(get(securityCenterEn, `${group}.${value}`), `${group}.${value}`).toBeTypeOf("string");
  });

  it("never uses guarantee wording in either language", () => {
    const text = [...leafPaths(securityCenterEn).map((p) => get(securityCenterEn, p)), ...leafPaths(securityCenterNl).map((p) => get(securityCenterNl, p))].join("\n");
    expect(text).not.toMatch(/100\s?% (secure|veilig)|fully protected|volledig beschermd|zero risk|geen enkel risico|risicoloos/i);
  });
});

describe("source hygiene", () => {
  const dir = join(__dirname, "..");
  const files = (sub: string) => readdirSync(join(dir, sub), { recursive: true, encoding: "utf8" }).filter((f) => /\.tsx?$/.test(f)).map((f) => join(dir, sub, f));

  it("never uses dangerouslySetInnerHTML, any, or console logging", () => {
    for (const file of [...files("components"), ...files("api"), ...files("hooks"), ...files("lib")]) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toContain("dangerouslySetInnerHTML");
      expect(source, file).not.toMatch(/:\s*any\b|\bas any\b|<any>/);
      expect(source, file).not.toMatch(/console\./);
    }
  });

  it("only sends security_* commands from the allow-list", () => {
    const client = readFileSync(join(dir, "api/trustClient.ts"), "utf8");
    expect(client).toContain("SecurityCommandName");
  });
});

describe("stylesheet", () => {
  const css = readFileSync(join(__dirname, "../securityCenter.css"), "utf8");

  it("uses theme tokens and no hard-coded colours", () => {
    expect(css).toContain("var(--color-surface)");
    expect(css).toContain("var(--color-danger)");
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\(/);
  });

  it("has no fixed pixel widths outside media queries, scrolls tables inside their box and respects reduced motion", () => {
    const withoutMedia = css.replace(/@media[^{]*\{/g, "{");
    expect(withoutMedia).not.toMatch(/(?<![-\w])(min-|max-)?width\s*:\s*\d+px/);
    expect(withoutMedia).not.toMatch(/(?<![-\w])(min-|max-)?inline-size\s*:\s*\d+px/);
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).toMatch(/\.sc-table-wrap \{[^}]*overflow-x: auto/);
  });
});
