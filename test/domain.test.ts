import { describe, expect, test } from "bun:test";
import { parseDomain } from "../src/domain";

const ok = (s: string) => {
  const p = parseDomain(s);
  if (!p.ok) throw new Error(`expected ok for "${s}": ${p.reason}`);
  return p.domain;
};

describe("parseDomain", () => {
  test("normalizes case, URLs, www and the trailing dot", () => {
    expect(ok("Example.COM").ascii).toBe("example.com");
    expect(ok("https://www.Example.com/path?x=1").ascii).toBe("example.com");
    expect(ok("example.com.").ascii).toBe("example.com");
    expect(ok("example.ru/offer").tld).toBe("ru");
  });

  test("converts IDNs to punycode", () => {
    const d = ok("zażółć.pl");
    expect(d.ascii.startsWith("xn--")).toBe(true);
    expect(d.ascii.endsWith(".pl")).toBe(true);
  });

  test("rejects anything other than name.tld", () => {
    for (const bad of ["", "nodot", "a.b.com", "exa mple.com", "-bad.com", "bad-.com", "a..com", "example.c", "example.123"]) {
      expect(parseDomain(bad).ok).toBe(false);
    }
  });

  test("www.com is a domain, not a subdomain", () => {
    expect(ok("www.com").ascii).toBe("www.com");
  });
});
