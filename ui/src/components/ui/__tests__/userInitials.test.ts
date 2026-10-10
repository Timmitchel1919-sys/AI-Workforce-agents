import { describe, expect, it } from "vitest";
import { initialsOf } from "../userInitials";

describe("initialsOf", () => {
  it("uses the first letters of the first and last name", () => {
    expect(initialsOf("Shaquil Alienda")).toBe("SA");
    expect(initialsOf("  ada   lovelace  byron ")).toBe("AB");
  });
  it("handles single names, e-mail labels and empty values", () => {
    expect(initialsOf("Ada")).toBe("A");
    expect(initialsOf("timmitchel1919@gmail.com")).toBe("T");
    expect(initialsOf("jan.de-vries@example.test")).toBe("JV");
    expect(initialsOf("   ")).toBe("?");
  });
});
