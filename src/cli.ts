#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { checkDomain } from "./check";
import type { Status, Verdict } from "./types";

const HELP = `dac: domain availability check (RDAP + WHOIS + DNS + optional registrar APIs)

Usage:
  dac example.com [other.pl ...]
  dac mybrand --tlds com,pl,dev,io
  dac -v example.ru               show evidence from every source

Options:
  -t, --tlds <list>       expand bare names with the given TLDs (e.g. com,pl,dev)
  -c, --concurrency <n>   how many domains to check at once (default 4)
      --no-whois          skip WHOIS (port 43)
  -j, --json              output JSON
  -v, --verbose           show evidence from each source
  -h, --help

Optional keys (enable the registrar layer):
  PORKBUN_API_KEY, PORKBUN_SECRET_KEY
  CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN

Exit codes: 0 available | 1 taken/unavailable | 2 undetermined/conflict | 3 invalid name | 64 usage error`;

const LABEL: Record<Status, [text: string, ansi: string, exit: number]> = {
  AVAILABLE: ["AVAILABLE", "32", 0],
  LIKELY_AVAILABLE: ["LIKELY AVAILABLE", "92", 0],
  TAKEN: ["TAKEN", "31", 1],
  UNAVAILABLE: ["UNAVAILABLE", "33", 1],
  CONFLICT: ["SOURCE CONFLICT", "35", 2],
  UNKNOWN: ["UNDETERMINED", "33", 2],
  INVALID: ["INVALID NAME", "90", 3],
};

const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const paint = (ansi: string, s: string) => (useColor ? `\x1b[${ansi}m${s}\x1b[0m` : s);

async function pool<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i] as T);
      }
    }),
  );
  return out;
}

function print(v: Verdict, verbose: boolean) {
  const [text, ansi] = LABEL[v.status];
  console.log(`${paint(ansi, text.padEnd(17))} ${v.domain || v.input}  ${paint("90", `(confidence: ${v.confidence})`)}`);
  console.log(paint("90", `  ${v.summary}`));
  if (verbose) {
    for (const e of v.evidence) console.log(`    ${e.source.padEnd(10)} ${e.vote.padEnd(12)} ${e.detail}`);
  }
  for (const n of v.notes) console.log(paint("90", `  • ${n}`));
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    allowPositionals: true,
    options: {
      tlds: { type: "string", short: "t" },
      concurrency: { type: "string", short: "c" },
      "no-whois": { type: "boolean" },
      json: { type: "boolean", short: "j" },
      verbose: { type: "boolean", short: "v" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help || positionals.length === 0) {
    console.log(HELP);
    return values.help ? 0 : 64;
  }

  const tlds = (values.tlds ?? "").split(",").map((t) => t.trim().replace(/^\./, "").toLowerCase()).filter(Boolean);
  const inputs: string[] = [];
  for (const p of positionals) {
    if (p.includes(".") || p.includes("://")) inputs.push(p);
    else if (tlds.length) inputs.push(...tlds.map((t) => `${p}.${t}`));
    else {
      console.error(`"${p}": no TLD. Provide a full domain (e.g. ${p}.com) or use --tlds com,pl,dev`);
      return 64;
    }
  }

  const unique = [...new Set(inputs)];
  const concurrency = Math.max(1, Number(values.concurrency) || 4);
  const results = await pool(unique, concurrency, (d) => checkDomain(d, { whois: !values["no-whois"] }));

  if (values.json) console.log(JSON.stringify(results, null, 2));
  else results.forEach((v) => print(v, Boolean(values.verbose)));

  return Math.max(...results.map((v) => LABEL[v.status][2]));
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(70);
  });
