import { describe, expect, it } from "vitest";
import { initials, safeRedirectPath } from "./utils";

describe("safeRedirectPath", () => {
  it.each([
    ["/w/acme", "/w/acme"],
    ["/invite/abc?x=1", "/invite/abc?x=1"],
    ["https://evil.example", "/w"],
    ["//evil.example", "/w"],
    ["/\\evil.example", "/w"],
    ["javascript:alert(1)", "/w"],
    [null, "/w"],
    ["", "/w"],
  ])("%s → %s", (input, expected) => {
    expect(safeRedirectPath(input)).toBe(expected);
  });
});

describe("initials", () => {
  it("uses first and last name", () => {
    expect(initials("Ada Lovelace")).toBe("AL");
    expect(initials("Ada")).toBe("A");
    expect(initials("  ")).toBe("?");
  });
});
