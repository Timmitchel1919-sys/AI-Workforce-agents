import { describe, expect, it } from "vitest";
import { integrationCenterEn } from "../../../i18n/locales/integrationCenter.en";
import { integrationCenterNl } from "../../../i18n/locales/integrationCenter.nl";
import { qs, toInstant } from "../api/integrationClient";
import { connectionNote, groupCapabilities, isWorking, parseConditions, parseParams, sandboxKey, sandboxSubstitute, splitList, trustAllowed } from "../lib/logic";
import { makeCapabilities, makeConnector, makeRow } from "./fixtures";

function keys(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k));
}

describe("catalogue", () => {
  it("has the same keys in English and Dutch, and no empty strings", () => {
    expect(keys(integrationCenterNl).sort()).toEqual(keys(integrationCenterEn).sort());
    const empties = (v: unknown): number =>
      typeof v === "string" ? (v.trim() === "" ? 1 : 0) : Object.values(v as object).reduce<number>((n, x) => n + empties(x), 0);
    expect(empties(integrationCenterEn)).toBe(0);
    expect(empties(integrationCenterNl)).toBe(0);
  });

  it("keeps the same placeholders in both languages", () => {
    const flat = (v: unknown, p = ""): [string, string][] =>
      typeof v === "string" ? [[p, v]] : Object.entries(v as object).flatMap(([k, x]) => flat(x, p ? `${p}.${k}` : k));
    const nl = new Map(flat(integrationCenterNl));
    for (const [key, text] of flat(integrationCenterEn)) {
      const holders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");
      expect(holders(nl.get(key) ?? ""), key).toBe(holders(text));
    }
  });
});

describe("connection state", () => {
  it("only treats HEALTHY and DEGRADED as working", () => {
    expect(isWorking("HEALTHY")).toBe(true);
    expect(isWorking("DEGRADED")).toBe(true);
    for (const s of ["DISCOVERED", "CONFIGURED", "CONNECTED", "DISCONNECTED", "DISABLED", "ERROR"]) expect(isWorking(s)).toBe(false);
  });
  it("never describes a non-HEALTHY connector as healthy", () => {
    for (const s of ["DISCOVERED", "CONFIGURED", "CONNECTED", "DISCONNECTED", "DISABLED", "ERROR", "DEGRADED", "SOMETHING_NEW"]) {
      expect(connectionNote(makeConnector({ status: s }))).not.toBe("healthy");
    }
    expect(connectionNote(makeConnector({ status: "HEALTHY" }))).toBe("healthy");
    expect(connectionNote(makeConnector({ status: "DISCOVERED" }))).toBe("notConnected");
  });
});

describe("trust rules", () => {
  it("lets an operator only lower trust, an administrator any", () => {
    expect(trustAllowed("LIMITED", "TRUSTED", false)).toBe(false);
    expect(trustAllowed("LIMITED", "LIMITED", false)).toBe(true);
    expect(trustAllowed("LIMITED", "SUSPENDED", false)).toBe(true);
    expect(trustAllowed("LIMITED", "TRUSTED", true)).toBe(true);
  });
});

describe("parsing", () => {
  it("parses simulator parameters as a JSON object only", () => {
    expect(parseParams("")).toEqual({ ok: true, value: {} });
    expect(parseParams('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    expect(parseParams("[1]")).toEqual({ ok: false });
    expect(parseParams('"x"')).toEqual({ ok: false });
    expect(parseParams("{nope")).toEqual({ ok: false });
  });
  it("parses field=value condition lines and types booleans and numbers", () => {
    expect(parseConditions("")).toEqual([]);
    expect(parseConditions("branch=main\nforced=true\ncount=3")).toEqual([
      { field: "branch", equals: "main" }, { field: "forced", equals: true }, { field: "count", equals: 3 },
    ]);
    expect(parseConditions("nonsense")).toBeNull();
    expect(parseConditions("=x")).toBeNull();
    expect(parseConditions("a=")).toBeNull();
  });
  it("splits comma lists without duplicates", () => {
    expect(splitList("a, b ,a,,c")).toEqual(["a", "b", "c"]);
  });
  it("reads the sandbox behaviour from either server shape", () => {
    expect(sandboxKey("allowed")).toBe("allowed");
    expect(sandboxKey("DENY")).toBe("blocked");
    expect(sandboxKey("substitute with x")).toBeNull();
    expect(sandboxSubstitute("substitute with email.draft")).toBe("email.draft");
    expect(sandboxSubstitute({ substitute: "email.draft" })).toBe("email.draft");
    expect(sandboxSubstitute("allowed")).toBeNull();
  });
});

describe("tool grouping", () => {
  it("lists every provider of one capability once, and only marks it mapped when a provider is", () => {
    const rows = [makeRow({ mappedToProject: false }), makeRow({ connectorId: "gitlab", provider: "GitLab", mappedToProject: true })];
    const [entry] = groupCapabilities(rows, [], true);
    expect(entry?.providers.map((p) => p.provider)).toEqual(["GitHub", "GitLab"]);
    expect(entry?.mapped).toBe(true);
    expect(groupCapabilities(rows, [], false)[0]?.mapped).toBeNull();
    expect(groupCapabilities([makeRow({ mappedToProject: false })], [], true)[0]?.mapped).toBe(false);
  });
  it("marks a capability unavailable when no provider implements it", () => {
    const [entry] = groupCapabilities([makeRow({ unavailable: "not implemented" })], [], false);
    expect(entry?.available).toBe(false);
  });
  it("sorts by capability and appends MCP capabilities as mapped", () => {
    const data = makeCapabilities({
      mcp: [{ capability: "mcp.docs.search", description: "Search", operation: "WRITE", risk: "MEDIUM", providers: [], approval: "likely", available: true }],
    });
    const out = groupCapabilities(data.capabilities, data.mcp, true);
    expect(out.map((e) => e.capability)).toEqual(["email.send", "mcp.docs.search", "repository.read"]);
    expect(out.find((e) => e.mcp)?.mapped).toBe(true);
  });
});

describe("client helpers", () => {
  it("drops empty query values", () => {
    expect(qs({ a: "x", b: "", c: undefined, d: 0 })).toBe("?a=x&d=0");
    expect(qs({})).toBe("");
  });
  it("turns a date into an instant", () => {
    expect(toInstant("2026-05-01")).toBe("2026-05-01T00:00:00.000Z");
    expect(toInstant("")).toBe("");
  });
});
