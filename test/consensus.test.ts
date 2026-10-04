import { describe, expect, test } from "bun:test";
import { decide } from "../src/consensus";
import type { Evidence, Source, Vote } from "../src/types";

const e = (source: Source, vote: Vote, notes?: string[]): Evidence => ({ source, vote, detail: "-", notes });
const run = (...ev: Evidence[]) => decide("x.com", "x.com", ev);

describe("decide", () => {
  test("RDAP 200 => taken", () => {
    expect(run(e("rdap", "taken")).status).toBe("TAKEN");
  });

  test("registered without delegation (RDAP taken + DNS NXDOMAIN) => taken, no conflict", () => {
    expect(run(e("rdap", "taken"), e("dns", "free")).status).toBe("TAKEN");
  });

  test("DNS sees NS while the registry says 404 => conflict", () => {
    expect(run(e("rdap", "free"), e("dns", "taken")).status).toBe("CONFLICT");
  });

  test("RDAP + WHOIS + DNS free => available (high)", () => {
    const v = run(e("rdap", "free"), e("whois", "free"), e("dns", "free"));
    expect([v.status, v.confidence]).toEqual(["AVAILABLE", "high"]);
  });

  test("RDAP + DNS free => likely available", () => {
    expect(run(e("rdap", "free"), e("dns", "free")).status).toBe("LIKELY_AVAILABLE");
  });

  test("a single source saying 'free' is not enough", () => {
    expect(run(e("rdap", "free"), e("whois", "unknown"), e("dns", "unknown")).status).toBe("UNKNOWN");
  });

  test("NXDOMAIN alone is not enough", () => {
    expect(run(e("dns", "free"), e("rdap", "unknown")).status).toBe("UNKNOWN");
  });

  test("registrar + RDAP free => available (high)", () => {
    const v = run(e("rdap", "free"), e("porkbun", "free"));
    expect([v.status, v.confidence]).toEqual(["AVAILABLE", "high"]);
  });

  test("registrar refuses while the registry has no record => unavailable (reservation/block)", () => {
    const v = run(e("rdap", "free"), e("cloudflare", "unavailable"), e("dns", "free"));
    expect(v.status).toBe("UNAVAILABLE");
    expect(v.summary).toContain("reservation");
  });

  test("evidence of registration beats a registrar refusal", () => {
    expect(run(e("rdap", "taken"), e("porkbun", "unavailable")).status).toBe("TAKEN");
  });

  test("only errors => undetermined", () => {
    expect(run(e("rdap", "unknown"), e("whois", "unknown"), e("dns", "unknown")).status).toBe("UNKNOWN");
  });

  test("premium ends up in the notes and the summary", () => {
    const v = run(e("rdap", "free"), e("porkbun", "free", ["premium (Porkbun)"]));
    expect(v.notes).toContain("premium (Porkbun)");
    expect(v.summary).toContain("premium");
  });
});
