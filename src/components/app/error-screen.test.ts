import { describe, expect, it } from "vitest";
import { isStaleVersionError } from "./error-screen";

describe("isStaleVersionError", () => {
  it("recognises errors from a tab running an older release", () => {
    const action = Object.assign(new Error('Server Action "abc" was not found on the server.'), {
      name: "UnrecognizedActionError",
    });
    expect(isStaleVersionError(action)).toBe(true);
    expect(
      isStaleVersionError(Object.assign(new Error("Loading chunk 12 failed"), { name: "ChunkLoadError" })),
    ).toBe(true);
  });

  it("leaves other errors alone", () => {
    expect(isStaleVersionError(new Error("Cannot read properties of undefined"))).toBe(false);
    expect(isStaleVersionError(null)).toBe(false);
  });
});
