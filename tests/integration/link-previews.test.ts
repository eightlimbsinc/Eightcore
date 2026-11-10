// Link previews: read once and cached; private addresses refused; redirects checked.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { linkPreviewsFor, parsePreview } from "@/modules/links/service";

const dns = vi.hoisted(() => ({ address: "93.184.216.34" }));
vi.mock("node:dns/promises", () => ({ lookup: vi.fn(async () => [{ address: dns.address, family: 4 }]) }));

const page = `<html><head><title>Fallback &amp; title</title>
  <meta property="og:title" content="Blend360 &#8211; Data &amp; AI">
  <meta content="We build AI" name="description">
  <meta property="og:image" content="/img/hero.jpg">
</head><body>…</body></html>`;

let calls: string[] = [];
beforeEach(() => {
  calls = [];
  dns.address = "93.184.216.34";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL) => {
      calls.push(String(url));
      if (url.pathname === "/old") return new Response(null, { status: 301, headers: { location: "/new" } });
      if (url.pathname === "/inside")
        return new Response(null, { status: 302, headers: { location: "http://10.0.0.1/" } });
      return new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("link previews", () => {
  it("reads Open Graph tags", () => {
    expect(parsePreview(page, "https://blend360.com/about")).toEqual({
      title: "Blend360 – Data & AI",
      description: "We build AI",
      imageUrl: "https://blend360.com/img/hero.jpg",
      siteName: "blend360.com",
    });
  });

  it("caches, follows safe redirects, and refuses private networks", async () => {
    const [first] = await linkPreviewsFor(["https://blend360.com/about"]);
    expect(first).toMatchObject({ url: "https://blend360.com/about", title: "Blend360 – Data & AI" });
    await linkPreviewsFor(["https://blend360.com/about"]);
    expect(calls).toEqual(["https://blend360.com/about"]); // second time from the cache

    expect((await linkPreviewsFor(["https://blend360.com/old"]))[0]?.url).toBe("https://blend360.com/old");
    expect(calls.slice(-2)).toEqual(["https://blend360.com/old", "https://blend360.com/new"]);

    // A redirect into a private network stops before fetching it.
    expect(await linkPreviewsFor(["https://blend360.com/inside"])).toEqual([]);
    expect(calls).not.toContain("http://10.0.0.1/");
    dns.address = "127.0.0.1";
    expect(await linkPreviewsFor(["https://sneaky.example/x"])).toEqual([]);
    expect(calls).not.toContain("https://sneaky.example/x");
    // Login-only links and non-web addresses aren't fetched at all.
    expect(await linkPreviewsFor(["https://app.clickup.com/t/abc", "javascript:alert(1)"])).toEqual([]);
  });
});
