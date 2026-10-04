import { parseDomain } from "./domain";
import { decide } from "./consensus";
import { getTldList } from "./lib/iana";
import { rdapCheck } from "./sources/rdap";
import { dnsCheck } from "./sources/dns";
import { whoisCheck } from "./sources/whois";
import { registrarJobs } from "./sources/registrar";
import type { Evidence, Source, Verdict } from "./types";

export interface Options {
  whois: boolean;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const invalid = (input: string, reason: string): Verdict => ({
  input,
  domain: "",
  status: "INVALID",
  confidence: "high",
  summary: reason,
  notes: [],
  evidence: [],
  checkedAt: new Date().toISOString(),
});

/** Queries all sources in parallel; one source failing does not abort the others. */
export async function checkDomain(input: string, opts: Options = { whois: true }): Promise<Verdict> {
  const parsed = parseDomain(input);
  if (!parsed.ok) return invalid(input, parsed.reason);
  const d = parsed.domain;

  const tlds = await getTldList().catch(() => undefined); // a missing TLD list doesn't block the check
  if (tlds && !tlds.has(d.tld)) return invalid(input, `.${d.tld} does not exist in the DNS root zone (IANA list)`);

  const jobs: [Source, Promise<Evidence>][] = [
    ["rdap", rdapCheck(d)],
    ["dns", dnsCheck(d)],
  ];
  if (opts.whois) jobs.push(["whois", whoisCheck(d)]);
  jobs.push(...registrarJobs(d));

  const evidence = await Promise.all(
    jobs.map(([source, job]) =>
      job.catch((e): Evidence => ({ source, vote: "unknown", detail: `error: ${msg(e)}` })),
    ),
  );
  return decide(input, d.ascii, evidence);
}
