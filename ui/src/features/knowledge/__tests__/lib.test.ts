import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { knowledgeEn } from "../../../i18n/locales/knowledge.en";
import { knowledgeNl } from "../../../i18n/locales/knowledge.nl";
import { filterParams } from "../api/knowledgeClient";
import {
  applyFilterChange, budgetPercent, centerOn, clampZoom, deleteBlockReason, filtersFromParams, groupByType, layoutGraph, matchNodes,
  relationsOf, splitTags, truncateLabel, visibleEdges, zoomAround, INITIAL_VIEW, MAX_ZOOM, MIN_ZOOM,
} from "../lib/logic";
import { EMPTY_FILTERS, GRAPH_NODE_KINDS, RELATION_TYPES } from "../types";
import { makeGraph, makeMemory } from "./fixtures";

function leafPaths(node: unknown, prefix = ""): string[] {
  if (typeof node === "string") return [prefix];
  return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) => leafPaths(v, prefix ? `${prefix}.${k}` : k));
}

describe("filters", () => {
  it("round-trips through the URL and drops empty values", () => {
    let params = new URLSearchParams("project=p1");
    params = applyFilterChange(params, "type", "ARCHITECTURAL");
    params = applyFilterChange(params, "status", "ACTIVE");
    expect(filtersFromParams(params)).toEqual({ ...EMPTY_FILTERS, type: "ARCHITECTURAL", status: "ACTIVE" });
    params = applyFilterChange(params, "type", "");
    expect(params.get("type")).toBeNull();
    expect(params.get("project")).toBe("p1");
  });

  it("builds API parameters, turning a date into a UTC instant", () => {
    const params = filterParams("p1", { ...EMPTY_FILTERS, type: "PROJECT", since: "2026-05-01" });
    expect(params).toMatchObject({ projectId: "p1", type: "PROJECT", since: "2026-05-01T00:00:00.000Z" });
  });

  it("splits tags and removes duplicates", () => {
    expect(splitTags(" api, billing ,api,, ")).toEqual(["api", "billing"]);
  });

  it("groups memories by type in first-seen order", () => {
    const groups = groupByType([makeMemory({ memoryId: "a", type: "PROJECT" }), makeMemory({ memoryId: "b", type: "AGENT" }), makeMemory({ memoryId: "c", type: "PROJECT" })]);
    expect(groups.map(([type, list]) => [type, list.length])).toEqual([["PROJECT", 2], ["AGENT", 1]]);
  });
});

describe("delete rules", () => {
  it("only allows deleting draft, archived or revoked memory that is neither critical nor architectural", () => {
    expect(deleteBlockReason({ status: "DRAFT", importance: "NORMAL", type: "PROJECT" })).toBeNull();
    expect(deleteBlockReason({ status: "ARCHIVED", importance: "LOW", type: "AGENT" })).toBeNull();
    expect(deleteBlockReason({ status: "REVOKED", importance: "HIGH", type: "PROJECT" })).toBeNull();
    expect(deleteBlockReason({ status: "ACTIVE", importance: "NORMAL", type: "PROJECT" })).toBe("status");
    expect(deleteBlockReason({ status: "DRAFT", importance: "CRITICAL", type: "PROJECT" })).toBe("protected");
    expect(deleteBlockReason({ status: "ARCHIVED", importance: "NORMAL", type: "ARCHITECTURAL" })).toBe("protected");
  });

  it("computes budget percentage safely", () => {
    expect(budgetPercent(1000, 4000)).toBe(25);
    expect(budgetPercent(10, 0)).toBe(0);
    expect(budgetPercent(9000, 4000)).toBe(100);
  });
});

describe("graph layout", () => {
  it("is deterministic and puts the project node at the centre", () => {
    const graph = makeGraph();
    const first = layoutGraph(graph.nodes, graph.edges);
    const second = layoutGraph([...graph.nodes].reverse(), [...graph.edges].reverse());
    const byId = (list: typeof first) => Object.fromEntries(list.map((n) => [n.id, [n.x, n.y, n.level]]));
    expect(byId(first)).toEqual(byId(second));
    expect(first.find((n) => n.kind === "PROJECT")).toMatchObject({ x: 0, y: 0, level: 0 });
    expect(first.find((n) => n.id === "comp:api")?.level).toBe(1);
    expect(first.find((n) => n.id === "tech:postgres")?.level).toBe(2);
  });

  it("places unreachable nodes on an outer ring and handles an empty graph", () => {
    const placed = layoutGraph([{ id: "a", label: "A", kind: "PROJECT" }, { id: "z", label: "Z", kind: "OTHER" }], []);
    expect(placed.find((n) => n.id === "z")?.level).toBe(1);
    expect(layoutGraph([], [])).toEqual([]);
  });

  it("never lets two nodes on one ring overlap", () => {
    const nodes = [{ id: "root", label: "Root", kind: "PROJECT" as const }, ...Array.from({ length: 40 }, (_, i) => ({ id: `n${i}`, label: `N${i}`, kind: "COMPONENT" as const }))];
    const edges = nodes.slice(1).map((n, i) => ({ id: `e${i}`, from: "root", to: n.id, type: "USES" as const, source: "t" }));
    const placed = layoutGraph(nodes, edges);
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        const d = Math.hypot(placed[i]!.x - placed[j]!.x, placed[i]!.y - placed[j]!.y);
        expect(d, `${placed[i]!.id}/${placed[j]!.id}`).toBeGreaterThan(40);
      }
    }
  });

  it("filters relation types, lists relations in both directions and searches nodes", () => {
    const graph = makeGraph();
    expect(visibleEdges(graph.edges, new Set(["USES"])).map((e) => e.id)).toEqual(["e2", "e3"]);
    expect(relationsOf("tech:postgres", graph.edges).map((r) => [r.edge.id, r.direction, r.neighborId])).toEqual([
      ["e3", "in", "comp:api"], ["e4", "in", "mem:m1"],
    ]);
    expect(matchNodes(graph.nodes, "post").map((n) => n.id)).toEqual(["tech:postgres", "mem:m1"]);
    expect(matchNodes(graph.nodes, "  ")).toEqual([]);
    expect(truncateLabel("a".repeat(40)).length).toBe(22);
  });

  it("clamps zoom and keeps the viewport centre fixed when zooming", () => {
    expect(clampZoom(100)).toBe(MAX_ZOOM);
    expect(clampZoom(0)).toBe(MIN_ZOOM);
    const zoomed = zoomAround(INITIAL_VIEW, 2);
    expect(zoomed.k).toBe(2);
    // the world point at the screen centre (0,0) stays at the screen centre
    expect(zoomed.x).toBeCloseTo(INITIAL_VIEW.x);
    expect(zoomed.y).toBeCloseTo(INITIAL_VIEW.y);
    expect(centerOn(10, 20, 1)).toEqual({ x: INITIAL_VIEW.x - 10, y: INITIAL_VIEW.y - 20, k: 1 });
  });
});

describe("catalogue", () => {
  const get = (root: unknown, path: string) => path.split(".").reduce((n, k) => (n as Record<string, unknown>)[k], root) as string;

  it("Dutch mirrors English key-for-key with matching placeholders and real translations", () => {
    expect(leafPaths(knowledgeNl).sort()).toEqual(leafPaths(knowledgeEn).sort());
    let different = 0;
    for (const path of leafPaths(knowledgeEn)) {
      const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
      expect(ph(get(knowledgeNl, path)), path).toEqual(ph(get(knowledgeEn, path)));
      expect(get(knowledgeNl, path).trim().length, path).toBeGreaterThan(0);
      if (get(knowledgeNl, path) !== get(knowledgeEn, path)) different += 1;
    }
    // Proper nouns and short technical words may legitimately match; everything else must be translated.
    expect(different / leafPaths(knowledgeEn).length).toBeGreaterThan(0.9);
  });

  it("every literal tt('key') used by the components exists in the English catalogue", () => {
    const dir = join(__dirname, "../components");
    const have = new Set(leafPaths(knowledgeEn));
    let checked = 0;
    for (const file of readdirSync(dir)) {
      const source = readFileSync(join(dir, file), "utf8");
      for (const match of source.matchAll(/\btt\(\s*"([\w.]+)"/g)) {
        expect(have.has(match[1] as string), `${file}: ${match[1]}`).toBe(true);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(150);
  });

  it("every dynamic tt(`prefix.${...}`) and label('group', ...) resolves to an existing group", () => {
    const dir = join(__dirname, "../components");
    for (const file of readdirSync(dir)) {
      const source = readFileSync(join(dir, file), "utf8");
      for (const match of source.matchAll(/\btt\(\s*`([\w.]+)\.\$\{/g)) {
        expect(get(knowledgeEn, match[1] as string), `${file}: ${match[1]}`).toBeTypeOf("object");
      }
      for (const match of source.matchAll(/\blabel\(\s*"(\w+)"/g)) {
        expect((knowledgeEn as Record<string, unknown>)[match[1] as string], `${file}: label group ${match[1]}`).toBeTypeOf("object");
      }
    }
  });

  it("has a label for every backend enum value", () => {
    const groups: [string, readonly string[]][] = [
      ["status", ["DRAFT", "ACTIVE", "SUPERSEDED", "ARCHIVED", "REVOKED"]],
      ["type", ["SYSTEM", "PROJECT", "ARCHITECTURAL", "USER_PREFERENCE", "EXECUTION", "AGENT", "DOCUMENT"]],
      ["source", ["USER", "PROJECT_FILE", "GITHUB", "EXECUTION", "AGENT", "DOCUMENT", "SYSTEM", "EXTERNAL_RESEARCH"]],
      ["confidence", ["VERIFIED", "USER_CONFIRMED", "SYSTEM_GENERATED", "AGENT_GENERATED", "INFERRED", "UNVERIFIED"]],
      ["importance", ["LOW", "NORMAL", "HIGH", "CRITICAL"]],
      ["relation", RELATION_TYPES],
      ["nodeKind", GRAPH_NODE_KINDS],
      ["rule", ["suspicious_creation", "unauthorized_retrieval", "excessive_retrieval", "conflicting_memory", "low_confidence_usage", "unusual_modification"]],
      ["usageResult", ["PENDING", "TASK_SUCCEEDED", "TASK_FAILED"]],
      ["excludedReason", ["over_budget", "not_relevant", "not_authorized"]],
      ["ingestStatus", ["ingested", "unchanged", "skipped"]],
      ["freshness", ["FRESH", "POTENTIALLY_STALE"]],
      ["retention", ["PERMANENT", "TEMPORARY"]],
      ["role", ["developer", "qa", "reviewer", "security", "analyst"]],
    ];
    for (const [group, values] of groups) {
      for (const value of values) expect(get(knowledgeEn, `${group}.${value}`), `${group}.${value}`).toBeTypeOf("string");
    }
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
});

describe("stylesheet", () => {
  const css = readFileSync(join(__dirname, "../knowledge.css"), "utf8");

  it("uses theme tokens and no hard-coded colours", () => {
    expect(css).toContain("var(--color-surface)");
    expect(css).toContain("var(--color-focus)");
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\(/);
  });

  it("has no fixed pixel widths outside media queries and respects reduced motion", () => {
    const withoutMedia = css.replace(/@media[^{]*\{/g, "{");
    expect(withoutMedia).not.toMatch(/(?<![-\w])(min-|max-)?width\s*:\s*\d+px/);
    expect(withoutMedia).not.toMatch(/(?<![-\w])(min-|max-)?inline-size\s*:\s*\d+px/);
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).toMatch(/\.kn-table-wrap \{[^}]*overflow-x: auto/);
  });
});
