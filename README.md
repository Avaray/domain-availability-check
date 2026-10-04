# 🤖 Domain Availability Check

A CLI that tells you whether a `name.tld` domain is available. It queries several independent sources
at once and combines their answers with conservative rules: **an error or timeout never means "available"**.

```
dac example.com
dac mybrand --tlds com,pl,dev,io,ru
dac -v example.ru            # show evidence from every source
dac -j example.com           # JSON output
```

## File tree

```
dac/
├── package.json            # build/test scripts; ZERO runtime dependencies
├── tsconfig.json
├── scripts/
│   └── build.ts            # builds both flavors: standalone (with Bun runtime) and lite (needs Bun)
├── src/
│   ├── cli.ts              # argument parsing, output formatting, exit codes
│   ├── check.ts            # orchestration: sources run in parallel, one failing doesn't break the rest
│   ├── consensus.ts        # pure function: evidence -> verdict (the core of the reliability)
│   ├── domain.ts           # normalization, punycode (IDN), name.tld validation
│   ├── types.ts
│   ├── sources/
│   │   ├── rdap.ts         # IANA bootstrap -> the registry's RDAP server
│   │   ├── whois.ts        # TCP/43 + response classification (for TLDs without RDAP)
│   │   ├── dns.ts          # NS lookups over DoH (Cloudflare + Google), independent of the registry
│   │   └── registrar.ts    # Porkbun / Cloudflare Registrar (optional, needs API keys)
│   └── lib/
│       ├── iana.ts         # TLD list, RDAP bootstrap, WHOIS referral, overrides.json
│       ├── cache.ts        # file cache in ~/.cache/dac (IANA data; on failure: stale beats nothing)
│       ├── http.ts         # fetch + timeout + retries (network errors, 429, 5xx)
│       ├── tcp.ts          # TCP client for WHOIS
│       └── throttle.ts     # per-server spacing between queries (protects against IP bans)
└── test/                   # bun test: consensus, WHOIS classification, TCP, sources with mocks
```

Dependencies: only built-in Bun APIs (`fetch`, `Bun.connect`, `bun:test`) and `node:*` modules.
Dev only: `typescript`, `@types/bun`.

## Install and build

```bash
bun install
bun test
bun run build                      # builds BOTH flavors into dist/
install -m755 dist/dac ~/.local/bin/dac          # or: dist/dac-lite
```

`bun run build` produces two binaries:

| | `dist/dac` (standalone) | `dist/dac-lite` (lite) |
|---|---|---|
| What it is | executable with the Bun runtime embedded | one minified JS bundle with a `#!/usr/bin/env bun` shebang |
| Size | ~80 MB | ~15 KB |
| Needs Bun on the target machine | no | **yes** (on `PATH`; Node.js cannot run it) |
| Portability | one build per OS/CPU (see cross-compiling below) | the same file runs on any OS/CPU that Bun supports |

Build only one of them:

```bash
bun run build:standalone           # dist/dac
bun run build:lite                 # dist/dac-lite
```

Cross-compiling (standalone only; the lite bundle is already platform-independent):

```bash
bun run build:linux-arm64          # dist/dac-linux-arm64 (Raspberry Pi; needs a 64-bit OS)
bun run build:linux-x64
bun run build:macos-arm64
bun run build:windows-x64
```

Without Bun on `PATH`, `dist/dac-lite` fails with `env: 'bun': No such file or directory`; use `dist/dac` there.

## How the verdict is produced

| Source | What it says | Weight |
|---|---|---|
| RDAP | 200 = registered, 404 = no record | strong (both directions) |
| WHOIS | domain record / "not found" | strong (both directions), text heuristics |
| DNS (NS) | a delegation exists = registered | strong for "taken", **weak** for "free" (NXDOMAIN) |
| Registrar | the registry confirms/refuses registration, premium status, price | strong; the only one that sees reservations |

| Status | When |
|---|---|
| `TAKEN` | any source sees a registration and no registry-level source says "free" |
| `AVAILABLE` | ≥3 sources say "free", or a registrar + ≥2 registry-level sources, or a registrar + DNS |
| `LIKELY AVAILABLE` | 2 sources say "free", no registrar involved |
| `UNAVAILABLE` | the registrar refuses (reserved, blocked, or taken) |
| `SOURCE CONFLICT` | e.g. DNS sees NS while RDAP returns 404: check manually |
| `UNDETERMINED` | too few votes (a single source, only errors, only NXDOMAIN) |

Exit codes: `0` available, `1` taken/unavailable, `2` undetermined/conflict, `3` invalid name, `64` usage error.

## Registrars (optional, highest reliability)

```bash
export PORKBUN_API_KEY=pk1_...  PORKBUN_SECRET_KEY=sk1_...
export CLOUDFLARE_ACCOUNT_ID=...  CLOUDFLARE_API_TOKEN=...
```

Without keys the tool runs on RDAP + WHOIS + DNS. With keys it also asks "can this actually be registered?",
because RDAP/WHOIS alone cannot tell an available domain from a reserved or premium one.

## Custom servers (ccTLDs missing from the IANA bootstrap)

`~/.config/dac/overrides.json` (or the path in `DAC_OVERRIDES`):

```json
{
  "rdap":  { "xx": "https://rdap.nic.xx/" },
  "whois": { "xx": "whois.nic.xx" }
}
```

## Limitations worth knowing

- Only `name.tld` domains (a single dot); `example.co.uk` is rejected.
- WHOIS classification is a heuristic (patterns for "not found" / record fields). An unknown format => `unknown`, never "available".
  For a TLD with an odd format, add a pattern in `src/sources/whois.ts` (`FREE`/`TAKEN`) and a test in `test/whois.test.ts`.
- Some ccTLDs have neither a public RDAP nor an accessible WHOIS (IP limits, captchas). Then only DNS remains, and the status is `UNDETERMINED`.
- DNS: NXDOMAIN may be cached (for minutes), and a domain can be registered without delegation. That is why it is a weak vote.
- WHOIS queries leave from your IP, spaced 1.5 s apart per server. With large lists, registries may rate-limit you.
- The result is a snapshot: only an actual registration attempt is final.
- The tests use mocks and a local TCP server. Queries to real registries need to be verified on your side
  (`dac -v` shows what each source said).
