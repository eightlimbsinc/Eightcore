import { describe, expect, it } from "vitest";
import { effectiveProjectRole } from "./policy";

describe("effectiveProjectRole", () => {
  it("makes owners and admins managers of every project, private included", () => {
    for (const role of ["owner", "admin"] as const) {
      expect(effectiveProjectRole(role, "workspace", null)).toBe("manager");
      expect(effectiveProjectRole(role, "private", null)).toBe("manager");
      expect(effectiveProjectRole(role, "private", "viewer")).toBe("manager");
    }
  });

  it("gives members the default role on workspace-visible projects", () => {
    expect(effectiveProjectRole("member", "workspace", null)).toBe("editor");
  });

  it("honours a member's explicit role, including a lower one", () => {
    expect(effectiveProjectRole("member", "workspace", "viewer")).toBe("viewer");
    expect(effectiveProjectRole("member", "private", "manager")).toBe("manager");
  });

  it("hides private projects from members without an explicit role", () => {
    expect(effectiveProjectRole("member", "private", null)).toBeNull();
  });

  it("hides every unshared project from guests", () => {
    expect(effectiveProjectRole("guest", "workspace", null)).toBeNull();
    expect(effectiveProjectRole("guest", "private", null)).toBeNull();
  });

  it("caps guests at editor", () => {
    expect(effectiveProjectRole("guest", "workspace", "manager")).toBe("editor");
    expect(effectiveProjectRole("guest", "private", "commenter")).toBe("commenter");
  });
});
