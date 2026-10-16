import { describe, expect, it } from "vitest";
import {
  correlation,
  groupSum,
  parseCsv,
  profileColumn,
  profilesToCsv,
  safeCsvCell,
  toNumber,
} from "../dataProfile";
import { geometry, filterString, DEFAULT_SPEC } from "../../creative/imageOps";

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, CRLF, BOM, embedded newlines and semicolons", () => {
    const t = parseCsv('﻿name,note\r\n"Smith, J","said ""hi""\nthere"\r\nAnn,ok\r\n');
    expect(t.columns).toEqual(["name", "note"]);
    expect(t.rows).toEqual([["Smith, J", 'said "hi"\nthere'], ["Ann", "ok"]]);
    expect(parseCsv("a;b\n1;2").rows).toEqual([["1", "2"]]);
  });
});

describe("statistics", () => {
  it("never counts missing as zero and computes correct sample statistics", () => {
    const p = profileColumn("x", ["1", "2", "", "NA", "3", "4"]);
    expect(p.type).toBe("number");
    expect(p.missing).toBe(2);
    expect(p.mean).toBe(2.5);
    expect(p.median).toBe(2.5);
    expect(p.std).toBeCloseTo(1.290994, 5);
    expect(profileColumn("y", ["", ""]).type).toBe("empty");
    expect(profileColumn("z", ["5"]).std).toBeUndefined();
  });

  it("parses numbers conservatively", () => {
    expect(toNumber("1,234.5")).toBe(1234.5);
    expect(toNumber("$12")).toBe(12);
    expect(toNumber("1.234,5")).toBeNull();
    expect(toNumber("12abc")).toBeNull();
  });

  it("correlation uses only complete pairs and refuses tiny samples", () => {
    const t = parseCsv("a,b\n1,2\n2,4\n3,6\n4,\n");
    expect(correlation(t, 0, 1)).toEqual({ r: 1, n: 3 });
    expect(correlation(parseCsv("a,b\n1,2\n2,4"), 0, 1).r).toBeNull();
  });

  it("group sums skip and count unusable rows", () => {
    const g = groupSum(parseCsv("cat,v\nA,1\nA,2\nB,5\n,3\nC,x"), 0, 1);
    expect(g.groups).toEqual([{ key: "B", sum: 5, n: 1 }, { key: "A", sum: 3, n: 2 }]);
    expect(g.skipped).toBe(2);
  });
});

describe("CSV export safety", () => {
  it("neutralizes spreadsheet formula injection", () => {
    expect(safeCsvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(safeCsvCell("+1")).toBe("'+1");
    expect(safeCsvCell("@x")).toBe("'@x");
    expect(safeCsvCell('a,"b"')).toBe('"a,""b"""');
    const csv = profilesToCsv([profileColumn("=cmd()", ["1"])]);
    expect(csv).toContain("'=cmd()");
  });
});

describe("image geometry", () => {
  it("keeps aspect, center-crops, and swaps axes on rotation", () => {
    const base = { ...DEFAULT_SPEC(4000), width: 1000 };
    expect(geometry(4000, 2000, base)).toMatchObject({ outW: 1000, outH: 500, sw: 4000, sh: 2000 });
    expect(geometry(4000, 2000, { ...base, cropAspect: 1 })).toMatchObject({ sx: 1000, sy: 0, sw: 2000, sh: 2000, outH: 1000 });
    expect(geometry(4000, 2000, { ...base, rotation: 90 })).toMatchObject({ outW: 1000, outH: 2000 });
    expect(geometry(10, 10, { ...base, width: 99999 }).outW).toBe(8192);
    expect(filterString({ ...base, brightness: 999, grayscale: true })).toBe("brightness(300%) contrast(100%) grayscale(100%)");
  });
});
