import type { Domain, Evidence } from "../types";
import { getWhoisServer } from "../lib/iana";
import { tcpQuery } from "../lib/tcp";
import { throttle } from "../lib/throttle";

/** Registries with an unusual query format (all others: just the domain name). */
const QUIRKS: Record<string, { server: string; query: (d: string) => string }> = {
  de: { server: "whois.denic.de", query: (d) => `-T dn,ace ${d}` },
  jp: { server: "whois.jprs.jp", query: (d) => `${d}/e` },
};

// Fields that only appear in the record of an existing domain.
const TAKEN = [
  /^\s*(creat(ed|ion date)|registered( on)?|registration (date|time)|registry expiry date|expir(y|ation|es)( date)?|paid-till|renewal date|(sponsoring )?registrar|name ?servers?|nserver)\s*:\s*\S/im,
  /^\s*(domain )?status\s*:\s*(connect|active|registered|ok\b|inactive|pending|redemption|hold|client|server|taken|not available|quarantine)/im,
  /^\s*state\s*:\s*(registered|delegated)/im,
];

const LIMITED =
  /limit exceeded|query limit|too many (queries|requests|connections)|quota exceeded|rate.?limit|try again (later|in)|access (denied|restricted)|blacklisted|permission denied|exceeded the (allowed|maximum)|connection limit|temporarily (blocked|banned)|has been (blocked|banned)/i;

// "No such domain" messages from various registries (heuristic; unknown format => "unknown").
const FREE = [
  /no match/i,
  /not found/i,
  /no entries found/i,
  /no data found/i,
  /no object found/i,
  /nothing found/i,
  /not registered/i,
  /no such domain/i,
  /no matching record/i,
  /no information available/i,
  /do not have an entry/i,
  /object_not_found/i,
  /available for registration/i,
  /\bis free\b/i,
  /^no found/im,
  /status\s*:\s*(free|available)\b/i,
];

export type WhoisClass = "taken" | "free" | "limited" | "unknown";

/** Conservative classification: "taken" > "limited" > "free" (free only for a short response with no record fields). */
export function classifyWhois(text: string): WhoisClass {
  if (TAKEN.some((r) => r.test(text))) return "taken";
  if (LIMITED.test(text)) return "limited";
  if (text.length < 6000 && FREE.some((r) => r.test(text))) return "free";
  return "unknown";
}

export async function whoisCheck(d: Domain): Promise<Evidence> {
  const quirk = QUIRKS[d.tld];
  const server = quirk?.server ?? (await getWhoisServer(d.tld));
  if (!server) return { source: "whois", vote: "unknown", detail: `no WHOIS server for .${d.tld}` };

  const query = quirk ? quirk.query(d.ascii) : d.ascii;
  const gap = Number(process.env.DAC_WHOIS_GAP_MS ?? 1500);
  let text = "";
  let lastErr: unknown;

  for (let attempt = 0; attempt < 2; attempt++) {
    await throttle(server, gap);
    try {
      text = await tcpQuery(server, 43, `${query}\r\n`);
      lastErr = undefined;
      break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr) {
    return { source: "whois", vote: "unknown", detail: `${server}: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}` };
  }
  if (!text.trim()) return { source: "whois", vote: "unknown", detail: `${server}: empty response` };

  switch (classifyWhois(text)) {
    case "taken":
      return { source: "whois", vote: "taken", detail: `domain record (${server})` };
    case "free":
      return { source: "whois", vote: "free", detail: `"not found" (${server})` };
    case "limited":
      return { source: "whois", vote: "unknown", detail: `${server}: query limit / IP blocked` };
    default:
      return { source: "whois", vote: "unknown", detail: `${server}: unrecognized response format` };
  }
}
