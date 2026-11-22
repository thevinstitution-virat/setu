import { afterEach, describe, expect, it, vi } from "vitest";
import { buildEvent, makeDeduper, parseDsn, parseStack, scrubUrl, sendEvent, tenantOfHost, toEnvelope } from "../src/lib/error-report";

describe("error reports (GlitchTip)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("parses a DSN and rejects unusable ones", () => {
    expect(parseDsn("https://abc123@errors.example.com/11")).toEqual({ key: "abc123", origin: "https://errors.example.com", projectId: "11" });
    expect(parseDsn("")).toBeNull();
    expect(parseDsn(undefined)).toBeNull();
    expect(parseDsn("https://errors.example.com/11")).toBeNull(); // no key
    expect(parseDsn("https://k@errors.example.com/abc")).toBeNull(); // no project id
    expect(parseDsn("not a url")).toBeNull();
  });

  it("never sends query strings, tokens or phone numbers in URLs", () => {
    expect(scrubUrl("https://sharma.ss.vpd.ceo/api/auth/welcome?t=secret-token")).toBe("https://sharma.ss.vpd.ceo/api/auth/welcome");
    expect(scrubUrl("https://a.ss.vpd.ceo/i/cmabc123def456ghi789jk/pdf#x")).toBe("https://a.ss.vpd.ceo/i/:token/pdf");
    expect(scrubUrl("/admin/retailers/9876543210")).toBe("/admin/retailers/:num");
    expect(scrubUrl("/admin/orders")).toBe("/admin/orders");
  });

  it("parses Chrome and Firefox stacks, oldest frame first", () => {
    const v8 = "Error: boom\n    at inner (https://x.ss.vpd.ceo/_next/static/chunks/abc.js:1:200)\n    at https://x.ss.vpd.ceo/_next/static/chunks/def.js?v=1:2:30";
    const f = parseStack(v8);
    expect(f).toHaveLength(2);
    expect(f[1]).toMatchObject({ function: "inner", lineno: 1, colno: 200 });
    expect(f[0].filename).toBe("https://x.ss.vpd.ceo/_next/static/chunks/def.js");
    expect(parseStack("inner@https://x/a.js:3:4\n@https://x/b.js:5:6")).toHaveLength(2);
    expect(parseStack(undefined)).toEqual([]);
  });

  it("builds an event with tags and the digest, without empty tags", () => {
    const err = Object.assign(new TypeError("x is undefined"), { digest: "12345" });
    const e = buildEvent({ error: err, platform: "javascript", url: "https://a.ss.vpd.ceo/orders?q=1", tags: { business: "a", empty: undefined } });
    expect(e.event_id).toMatch(/^[0-9a-f]{32}$/);
    expect(e.exception.values[0]).toMatchObject({ type: "TypeError", value: "x is undefined" });
    expect(e.tags).toEqual({ business: "a", digest: "12345" });
    expect(e.request).toEqual({ url: "https://a.ss.vpd.ceo/orders", method: undefined });
    expect(buildEvent({ error: { odd: true }, platform: "node" }).exception.values[0].type).toBe("NonError");
  });

  it("writes a three-line envelope and posts it as text/plain with the key in the URL", async () => {
    const e = buildEvent({ error: new Error("boom"), platform: "node" });
    const lines = toEnvelope(e).split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[1])).toEqual({ type: "event" });
    expect(JSON.parse(lines[2]).event_id).toBe(e.event_id);

    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const ok = await sendEvent(parseDsn("https://k1@errors.example.com/10")!, e);
    expect(ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://errors.example.com/api/10/envelope/?sentry_key=k1&sentry_version=7");
    expect((init.headers as Record<string, string>)["Content-Type"]).toMatch(/^text\/plain/);
  });

  it("never throws when GlitchTip is down", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    await expect(sendEvent(parseDsn("https://k@e.example.com/1")!, buildEvent({ error: "x", platform: "node" }))).resolves.toBe(false);
  });

  it("drops repeats inside the window", () => {
    const fresh = makeDeduper(60_000);
    expect(fresh("a", 0)).toBe(true);
    expect(fresh("a", 30_000)).toBe(false);
    expect(fresh("a", 61_000)).toBe(true);
    expect(fresh("b", 61_000)).toBe(true);
  });

  it("names the business from the host", () => {
    expect(tenantOfHost("sharma.ss.vpd.ceo", "ss.vpd.ceo")).toBe("sharma");
    expect(tenantOfHost("ss.vpd.ceo:443", "ss.vpd.ceo")).toBe("(platform)");
    expect(tenantOfHost("order.agarwal.in", "ss.vpd.ceo")).toBe("order.agarwal.in");
    expect(tenantOfHost(undefined, "ss.vpd.ceo")).toBeUndefined();
  });
});
