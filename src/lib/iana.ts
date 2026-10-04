import { homedir } from "node:os";
import { join } from "node:path";
import { cached } from "./cache";
import { fetchRetry } from "./http";
import { tcpQuery } from "./tcp";

const DAY = 86_400_000;

/** All TLDs in the DNS root. Lets us tell "TLD doesn't exist" apart from "TLD unsupported". */
export async function getTldList(): Promise<Set<string>> {
  const list = await cached<string[]>("tlds", 7 * DAY, async () => {
    const res = await fetchRetry("https://data.iana.org/TLD/tlds-alpha-by-domain.txt");
    if (!res.ok) throw new Error(`IANA TLD list: HTTP ${res.status}`);
    return (await res.text())
      .split("\n")
      .map((l) => l.trim().toLowerCase())
      .filter((l) => l && !l.startsWith("#"));
  });
  return new Set(list);
}

/** Custom entries (e.g. "hidden" ccTLD RDAP servers that are missing from the IANA bootstrap). */
export interface Overrides {
  rdap?: Record<string, string>;
  whois?: Record<string, string>;
}

export async function loadOverrides(): Promise<Overrides> {
  const path =
    process.env.DAC_OVERRIDES ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "dac", "overrides.json");
  try {
    const file = Bun.file(path);
    return (await file.exists()) ? ((await file.json()) as Overrides) : {};
  } catch {
    return {};
  }
}

/** RDAP server for a TLD: custom entries first, then the IANA bootstrap (RFC 9224). */
export async function getRdapBase(tld: string): Promise<string | undefined> {
  const overrides = await loadOverrides();
  if (overrides.rdap?.[tld]) return overrides.rdap[tld];

  const map = await cached<Record<string, string>>("rdap-bootstrap", DAY, async () => {
    const res = await fetchRetry("https://data.iana.org/rdap/dns.json");
    if (!res.ok) throw new Error(`IANA RDAP bootstrap: HTTP ${res.status}`);
    const json = (await res.json()) as { services: [string[], string[]][] };
    const out: Record<string, string> = {};
    for (const [tlds, urls] of json.services) {
      const url = urls.find((u) => u.startsWith("https://")) ?? urls[0];
      if (url) for (const t of tlds) out[t.toLowerCase()] = url;
    }
    return out;
  });
  return map[tld];
}

/** WHOIS server for a TLD: custom entries first, then a referral from whois.iana.org (cached 30 days). */
export async function getWhoisServer(tld: string): Promise<string | undefined> {
  const overrides = await loadOverrides();
  if (overrides.whois?.[tld]) return overrides.whois[tld];

  const server = await cached<string>(
    `whois-server-${tld}`,
    30 * DAY,
    async () => {
      const text = await tcpQuery("whois.iana.org", 43, `${tld}\r\n`);
      return text.match(/^\s*(?:whois|refer):\s*(\S+)/im)?.[1]?.toLowerCase() ?? "";
    },
    (v) => v !== "", // don't cache "no server" for 30 days
  );
  return server || undefined;
}
