import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rdapCheck } from "../src/sources/rdap";
import { dnsCheck } from "../src/sources/dns";
import { cloudflareCheck, porkbunCheck } from "../src/sources/registrar";
import { checkDomain } from "../src/check";
import type { Domain } from "../src/types";

const realFetch = globalThis.fetch;
const dom = (ascii: string): Domain => {
  const [label, tld] = ascii.split(".") as [string, string];
  return { input: ascii, ascii, label, tld };
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const mockFetch = (handler: (url: string, init?: RequestInit) => Response) => {
  globalThis.fetch = ((input: unknown, init?: RequestInit) => Promise.resolve(handler(String(input), init))) as typeof fetch;
};

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "dac-test-"));
  process.env.DAC_CACHE_DIR = dir;
  process.env.DAC_OVERRIDES = join(dir, "missing.json");
  process.env.DAC_RETRIES = "0";
  process.env.DAC_PORKBUN_GAP_MS = "0";
  const seed = (key: string, value: unknown) => writeFileSync(join(dir, `${key}.json`), JSON.stringify({ at: Date.now(), value }));
  seed("rdap-bootstrap", { com: "https://rdap.test/v1/", ru: "https://rdap.ru.test/" });
  seed("tlds", ["com", "ru", "zz"]);
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("rdapCheck", () => {
  test("200 with a domain object => taken + expiry date", async () => {
    mockFetch(() => json({ objectClassName: "domain", ldhName: "x.com", status: ["client hold"], events: [{ eventAction: "expiration", eventDate: "2027-01-02T00:00:00Z" }] }));
    const ev = await rdapCheck(dom("x.com"));
    expect(ev.vote).toBe("taken");
    expect(ev.notes?.join(" ")).toContain("2027-01-02");
    expect(ev.notes?.join(" ")).toContain("client hold");
  });
  test("404 => free", async () => {
    mockFetch(() => json({ errorCode: 404 }, 404));
    expect((await rdapCheck(dom("x.com"))).vote).toBe("free");
  });
  test("429 / 5xx / 403 => unknown, never free", async () => {
    for (const status of [429, 500, 403]) {
      mockFetch(() => json({}, status));
      expect((await rdapCheck(dom("x.com"))).vote).toBe("unknown");
    }
  });
  test("200 without a domain object => unknown", async () => {
    mockFetch(() => json({ hello: "world" }));
    expect((await rdapCheck(dom("x.com"))).vote).toBe("unknown");
  });
  test("TLD without an RDAP server => unknown", async () => {
    expect((await rdapCheck(dom("x.zz"))).vote).toBe("unknown");
  });
  test("a network error throws (checkDomain catches it)", async () => {
    globalThis.fetch = (() => Promise.reject(new Error("ECONNRESET"))) as unknown as typeof fetch;
    await expect(rdapCheck(dom("x.com"))).rejects.toThrow();
  });
});

describe("dnsCheck", () => {
  const byHost = (cf: unknown, g: unknown) => (url: string) => json(url.includes("cloudflare") ? cf : g);
  test("both NXDOMAIN => free (weak vote)", async () => {
    mockFetch(byHost({ Status: 3 }, { Status: 3 }));
    expect((await dnsCheck(dom("x.com"))).vote).toBe("free");
  });
  test("one resolver sees NS => taken", async () => {
    mockFetch(byHost({ Status: 0, Answer: [{ type: 2 }] }, { Status: 3 }));
    expect((await dnsCheck(dom("x.com"))).vote).toBe("taken");
  });
  test("SERVFAIL / errors => unknown", async () => {
    mockFetch(byHost({ Status: 2 }, { Status: 2 }));
    expect((await dnsCheck(dom("x.com"))).vote).toBe("unknown");
  });
});

describe("registrar adapters", () => {
  test("Porkbun: yes / no / error", async () => {
    mockFetch(() => json({ status: "SUCCESS", response: { avail: "yes", price: "9.73", premium: "no" } }));
    expect((await porkbunCheck(dom("x.com"), "k", "s")).vote).toBe("free");
    mockFetch(() => json({ status: "SUCCESS", response: { avail: "no" } }));
    expect((await porkbunCheck(dom("x.com"), "k", "s")).vote).toBe("unavailable");
    mockFetch(() => json({ status: "ERROR", message: "Rate limit exceeded" }, 429));
    expect((await porkbunCheck(dom("x.com"), "k", "s")).vote).toBe("unknown");
  });
  test("Porkbun: premium adds a note", async () => {
    mockFetch(() => json({ status: "SUCCESS", response: { avail: "yes", price: "999", premium: "yes" } }));
    expect((await porkbunCheck(dom("x.com"), "k", "s")).notes).toContain("premium (Porkbun)");
  });
  test("Cloudflare: registrable / unavailable / unsupported TLD / error", async () => {
    const row = (r: object) => json({ success: true, result: { domains: [{ name: "x.com", ...r }] } });
    mockFetch(() => row({ registrable: true, tier: "standard", pricing: { currency: "USD", registration_cost: "8.57", renewal_cost: "8.57" } }));
    expect((await cloudflareCheck(dom("x.com"), "a", "t")).vote).toBe("free");
    mockFetch(() => row({ registrable: false, reason: "domain_unavailable" }));
    expect((await cloudflareCheck(dom("x.com"), "a", "t")).vote).toBe("unavailable");
    mockFetch(() => row({ registrable: false, reason: "extension_not_supported" }));
    expect((await cloudflareCheck(dom("x.com"), "a", "t")).vote).toBe("unknown");
    mockFetch(() => row({ registrable: false, reason: "domain_premium", tier: "premium" }));
    expect((await cloudflareCheck(dom("x.com"), "a", "t")).vote).toBe("free");
    mockFetch(() => json({ success: false, errors: [{ code: 10000, message: "Authentication error" }] }, 403));
    expect((await cloudflareCheck(dom("x.com"), "a", "t")).vote).toBe("unknown");
  });
});

describe("checkDomain (integration, WHOIS disabled)", () => {
  const router = (rdapStatus: number, dns: object) => (url: string) => {
    if (url.includes("rdap")) return rdapStatus === 200 ? json({ objectClassName: "domain", ldhName: "x" }) : json({}, rdapStatus);
    return json(dns);
  };

  test("taken", async () => {
    mockFetch(router(200, { Status: 0, Answer: [{ type: 2 }] }));
    const v = await checkDomain("X.com", { whois: false });
    expect(v.status).toBe("TAKEN");
    expect(v.evidence.map((e) => e.source).sort()).toEqual(["dns", "rdap"]);
  });
  test("RDAP 404 + NXDOMAIN => likely available", async () => {
    mockFetch(router(404, { Status: 3 }));
    expect((await checkDomain("x.com", { whois: false })).status).toBe("LIKELY_AVAILABLE");
  });
  test("an RDAP outage doesn't spoil the result: DNS alone => undetermined", async () => {
    mockFetch(router(500, { Status: 3 }));
    expect((await checkDomain("x.com", { whois: false })).status).toBe("UNKNOWN");
  });
  test("a network exception in one source becomes 'no vote'", async () => {
    mockFetch((url) => {
      if (url.includes("rdap")) throw new Error("boom");
      return json({ Status: 3 });
    });
    const v = await checkDomain("x.com", { whois: false });
    expect(v.evidence.find((e) => e.source === "rdap")?.vote).toBe("unknown");
  });
  test("nonexistent TLD and bad syntax => INVALID", async () => {
    expect((await checkDomain("x.nonexistent", { whois: false })).status).toBe("INVALID");
    expect((await checkDomain("a.b.com", { whois: false })).status).toBe("INVALID");
  });
});
