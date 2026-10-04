import type { Domain, Evidence } from "../types";
import { getRdapBase } from "../lib/iana";
import { fetchRetry } from "../lib/http";

const INTERESTING = /pending ?delete|redemption|pending ?restore|hold|inactive/i;

/** RDAP: 200 = registered, 404 = no record (does NOT yet mean "can be registered"). */
export async function rdapCheck(d: Domain): Promise<Evidence> {
  const base = await getRdapBase(d.tld);
  if (!base) return { source: "rdap", vote: "unknown", detail: `no RDAP server for .${d.tld}` };

  const url = `${base.replace(/\/+$/, "")}/domain/${d.ascii}`;
  const host = new URL(url).host;
  const res = await fetchRetry(url, { headers: { accept: "application/rdap+json, application/json" } });

  if (res.status === 404) {
    await res.body?.cancel();
    return { source: "rdap", vote: "free", detail: `HTTP 404 from ${host}` };
  }

  if (res.status === 200) {
    let json: any;
    try {
      json = await res.json();
    } catch {
      return { source: "rdap", vote: "unknown", detail: `${host}: HTTP 200 but invalid JSON` };
    }
    if (json?.objectClassName !== "domain" && !json?.ldhName) {
      return { source: "rdap", vote: "unknown", detail: `${host}: HTTP 200 without a domain object` };
    }
    const notes: string[] = [];
    const statuses = ((json.status as unknown[]) ?? []).filter((s): s is string => typeof s === "string");
    if (statuses.some((s) => INTERESTING.test(s))) notes.push(`RDAP status: ${statuses.join(", ")}`);
    const expiry = ((json.events as any[]) ?? []).find((e) => e?.eventAction === "expiration")?.eventDate;
    if (typeof expiry === "string") notes.push(`expires: ${expiry.slice(0, 10)}`);
    return { source: "rdap", vote: "taken", detail: `domain exists (${host})`, notes };
  }

  await res.body?.cancel();
  return { source: "rdap", vote: "unknown", detail: `${host}: HTTP ${res.status}` };
}
