import { describe, expect, it } from "vitest";
import { durationBetween, formatDurationMs } from "../duration";

describe("formatDurationMs", () => {
  it("formats sub-second durations in ms", () => {
    expect(formatDurationMs(420)).toBe("420ms");
  });
  it("formats seconds with one decimal", () => {
    expect(formatDurationMs(1200)).toBe("1.2s");
    expect(formatDurationMs(42_000)).toBe("42.0s");
  });
  it("formats minutes and seconds", () => {
    expect(formatDurationMs(3 * 60_000 + 18_000)).toBe("3m 18s");
    expect(formatDurationMs(3 * 60_000)).toBe("3m");
  });
  it("formats hours and minutes, no seconds", () => {
    expect(formatDurationMs(60 * 60_000 + 4 * 60_000)).toBe("1h 04m");
  });
  it("never fabricates a value for missing/invalid input", () => {
    expect(formatDurationMs(null)).toBe("—");
    expect(formatDurationMs(undefined)).toBe("—");
    expect(formatDurationMs(-5)).toBe("—");
    expect(formatDurationMs(Number.NaN)).toBe("—");
  });
});

describe("durationBetween", () => {
  it("computes a real duration from two ISO timestamps", () => {
    expect(
      durationBetween("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:42.000Z"),
    ).toBe(42_000);
  });
  it("returns null when either timestamp is missing", () => {
    expect(durationBetween(undefined, "2026-01-01T00:00:00.000Z")).toBeNull();
    expect(durationBetween("2026-01-01T00:00:00.000Z", undefined)).toBeNull();
  });
  it("returns null for an end before start (never a negative duration)", () => {
    expect(
      durationBetween("2026-01-01T00:00:10.000Z", "2026-01-01T00:00:00.000Z"),
    ).toBeNull();
  });
});
