import { describe, expect, it } from "vitest";
import { createWorkspaceInput, slugify, workspaceSlug } from "./validators";
import { suggestProjectKey, projectKey } from "@/modules/projects/validators";

describe("workspace slug", () => {
  it.each(["acme", "8limbs", "acme-studio", "a1"])("accepts %s", (slug) => {
    expect(workspaceSlug.safeParse(slug).success).toBe(true);
  });

  it.each(["a", "-acme", "acme-", "Acme Studio", "acme_studio", "new", "api", "x".repeat(49)])(
    "rejects %s",
    (slug) => {
      expect(workspaceSlug.safeParse(slug).success).toBe(false);
    },
  );

  it("normalises case", () => {
    expect(workspaceSlug.parse("ACME")).toBe("acme");
  });

  it("slugifies names", () => {
    expect(slugify("8limbs Inc.")).toBe("8limbs-inc");
    expect(slugify("  Café   Créatif ")).toBe("cafe-creatif");
  });

  it("trims names and requires one", () => {
    expect(createWorkspaceInput.safeParse({ name: "   ", slug: "ok-slug" }).success).toBe(false);
  });
});

describe("project key", () => {
  it("suggests keys from names", () => {
    expect(suggestProjectKey("Acme Website")).toBe("AW");
    expect(suggestProjectKey("Platform")).toBe("PLAT");
    expect(suggestProjectKey("x")).toBe("XPRJ");
  });

  it("validates and uppercases keys", () => {
    expect(projectKey.parse("web")).toBe("WEB");
    expect(projectKey.safeParse("1WEB").success).toBe(false);
    expect(projectKey.safeParse("W").success).toBe(false);
    expect(projectKey.safeParse("ABCDEFGHIJK").success).toBe(false);
  });
});
