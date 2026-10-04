import { domainToASCII } from "node:url";
import type { Domain } from "./types";

export type Parsed = { ok: true; domain: Domain } | { ok: false; reason: string };

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const TLD = /^([a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

/** Accepts "Example.COM", "https://www.example.com/x", "zażółć.pl". Returns only name.tld domains. */
export function parseDomain(input: string): Parsed {
  let host = input.trim().toLowerCase();
  if (!host) return { ok: false, reason: "empty name" };

  if (host.includes("://")) {
    try {
      host = new URL(host).hostname;
    } catch {
      return { ok: false, reason: "invalid URL" };
    }
  } else {
    host = host.split(/[/?#]/, 1)[0] ?? "";
  }

  host = host.replace(/\.$/, "");
  if (host.startsWith("www.") && host.split(".").length > 2) host = host.slice(4);

  const ascii = domainToASCII(host); // punycode for IDNs; "" when invalid
  if (!ascii) return { ok: false, reason: "invalid characters in name" };

  const labels = ascii.split(".");
  if (labels.length !== 2) {
    return { ok: false, reason: "only name.tld domains (a single dot) are supported" };
  }
  const [label, tld] = labels as [string, string];
  if (ascii.length > 253 || !LABEL.test(label)) {
    return { ok: false, reason: "invalid name (a-z, 0-9, hyphen; max 63 chars; no hyphen at either end)" };
  }
  if (!TLD.test(tld)) return { ok: false, reason: "invalid TLD" };

  return { ok: true, domain: { input, ascii, label, tld } };
}
