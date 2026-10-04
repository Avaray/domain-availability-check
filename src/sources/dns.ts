import type { Domain, Evidence } from "../types";
import { fetchRetry } from "../lib/http";

// Deliberately unfiltered resolvers only (Quad9 returns NXDOMAIN for blocklisted domains).
const RESOLVERS = [
  { name: "cloudflare", url: (n: string) => `https://cloudflare-dns.com/dns-query?name=${n}&type=NS` },
  { name: "google", url: (n: string) => `https://dns.google/resolve?name=${n}&type=NS` },
];

type Answer = { name: string; result: "ns" | "nxdomain" | "other"; detail: string };

async function ask(resolver: (typeof RESOLVERS)[number], domain: string): Promise<Answer> {
  const name = resolver.name;
  try {
    const res = await fetchRetry(resolver.url(domain), { headers: { accept: "application/dns-json" } });
    if (!res.ok) {
      await res.body?.cancel();
      return { name, result: "other", detail: `${name}: HTTP ${res.status}` };
    }
    const json = (await res.json()) as { Status?: number; Answer?: { type: number }[] };
    if (json.Status === 0 && json.Answer?.some((a) => a.type === 2)) return { name, result: "ns", detail: `${name}: NS` };
    if (json.Status === 3) return { name, result: "nxdomain", detail: `${name}: NXDOMAIN` };
    return { name, result: "other", detail: `${name}: rcode ${json.Status ?? "?"}` };
  } catch (e) {
    return { name, result: "other", detail: `${name}: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * DNS is strong evidence for "taken" (an NS delegation exists) but only WEAK evidence for "free":
 * a domain can be registered without delegation (hold, no NS), and NXDOMAIN may be cached.
 */
export async function dnsCheck(d: Domain): Promise<Evidence> {
  const answers = await Promise.all(RESOLVERS.map((r) => ask(r, d.ascii)));
  const ns = answers.filter((a) => a.result === "ns");
  const nx = answers.filter((a) => a.result === "nxdomain");

  if (ns.length) return { source: "dns", vote: "taken", detail: `NS delegation exists (${ns.map((a) => a.name).join(", ")})` };
  if (nx.length) return { source: "dns", vote: "free", detail: `NXDOMAIN (${nx.length}/${RESOLVERS.length} resolvers)` };
  return { source: "dns", vote: "unknown", detail: answers.map((a) => a.detail).join("; ") };
}
