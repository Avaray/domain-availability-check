import type { Domain, Evidence, Source } from "../types";
import { fetchRetry } from "../lib/http";
import { throttle } from "../lib/throttle";

/**
 * The registrar layer = an actual "can I register this?" check (an EPP check at the registry),
 * including premium status and price. Enabled only when you set API keys in environment variables.
 */

export async function porkbunCheck(d: Domain, key: string, secret: string): Promise<Evidence> {
  await throttle("porkbun", Number(process.env.DAC_PORKBUN_GAP_MS ?? 1100)); // account default: 10 checks / 10 s
  const res = await fetchRetry(`https://api.porkbun.com/api/json/v3/domain/checkDomain/${d.ascii}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "x-secret-api-key": secret },
    body: "{}",
  });
  const json: any = await res.json().catch(() => null);
  if (!json || json.status !== "SUCCESS") {
    return { source: "porkbun", vote: "unknown", detail: `Porkbun: ${json?.message ?? `HTTP ${res.status}`}` };
  }

  const r = json.response ?? {};
  const raw = r.avail ?? r.available;
  const premium = r.premium === true || r.premium === "yes";
  const price = r.price ? ` (${r.price} USD${premium ? ", premium" : ""})` : "";

  if (raw === true || raw === "yes" || raw === "available") {
    return { source: "porkbun", vote: "free", detail: `registry: available${price}`, notes: premium ? ["premium (Porkbun)"] : [] };
  }
  if (raw === false || raw === "no" || raw === "unavailable") {
    return { source: "porkbun", vote: "unavailable", detail: "registry: unavailable" };
  }
  return { source: "porkbun", vote: "unknown", detail: "Porkbun: unrecognized response" };
}

export async function cloudflareCheck(d: Domain, accountId: string, token: string): Promise<Evidence> {
  const res = await fetchRetry(`https://api.cloudflare.com/client/v4/accounts/${accountId}/registrar/domain-check`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ domains: [d.ascii] }),
  });
  const json: any = await res.json().catch(() => null);
  if (!json?.success) {
    return { source: "cloudflare", vote: "unknown", detail: `Cloudflare: ${json?.errors?.[0]?.message ?? `HTTP ${res.status}`}` };
  }

  const row = (json.result?.domains as any[] | undefined)?.find((x) => x?.name === d.ascii);
  if (!row) return { source: "cloudflare", vote: "unknown", detail: "Cloudflare: no result for the domain" };

  if (row.registrable === true) {
    const p = row.pricing ? ` (${row.pricing.registration_cost} ${row.pricing.currency})` : "";
    return { source: "cloudflare", vote: "free", detail: `registry: available${p}` };
  }
  switch (row.reason) {
    case "domain_unavailable":
      return { source: "cloudflare", vote: "unavailable", detail: "registry: registered or reserved" };
    case "domain_premium": // not registered, but premium-priced
      return { source: "cloudflare", vote: "free", detail: "registry: available as premium", notes: ["premium (Cloudflare)"] };
    case "extension_disallows_registration":
      return { source: "cloudflare", vote: "unknown", detail: "registry has paused new registrations for this TLD", notes: ["registrations in this TLD are paused"] };
    default: // extension_not_supported(_via_api): no vote; must never be treated as "taken"
      return { source: "cloudflare", vote: "unknown", detail: `Cloudflare does not support this TLD (${row.reason ?? "?"})` };
  }
}

/** Returns jobs only for the registrars that are configured. */
export function registrarJobs(d: Domain): [Source, Promise<Evidence>][] {
  const jobs: [Source, Promise<Evidence>][] = [];
  const { PORKBUN_API_KEY, PORKBUN_SECRET_KEY, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN } = process.env;
  if (PORKBUN_API_KEY && PORKBUN_SECRET_KEY) jobs.push(["porkbun", porkbunCheck(d, PORKBUN_API_KEY, PORKBUN_SECRET_KEY)]);
  if (CLOUDFLARE_ACCOUNT_ID && CLOUDFLARE_API_TOKEN) jobs.push(["cloudflare", cloudflareCheck(d, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN)]);
  return jobs;
}
