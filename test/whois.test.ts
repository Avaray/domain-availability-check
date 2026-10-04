import { describe, expect, test } from "bun:test";
import { classifyWhois } from "../src/sources/whois";
import { tcpQuery } from "../src/lib/tcp";

const SAMPLES: Record<string, [string, ReturnType<typeof classifyWhois>]> = {
  "com: not found": [
    'No match for "EXAMPLE-ZZZ.COM".\r\n>>> Last update of whois database: 2026-10-04T10:00:00Z <<<\r\n\r\nNOTICE: The expiration date displayed in this record is the date the registrar\'s sponsorship...',
    "free",
  ],
  "com: record": [
    "   Domain Name: EXAMPLE.COM\r\n   Registry Domain ID: 2336799_DOMAIN_COM-VRSN\r\n   Registrar WHOIS Server: whois.iana.org\r\n   Creation Date: 1995-08-14T04:00:00Z\r\n   Registry Expiry Date: 2026-08-13T04:00:00Z\r\n   Name Server: A.IANA-SERVERS.NET\r\n",
    "taken",
  ],
  "ru: not found": ["% TCI whois server\r\n% Last updated on 2026-10-04 10:00:00\r\nNo entries found for the selected source(s).\r\n", "free"],
  "ru: record": ["domain:        EXAMPLE.RU\r\nnserver:       ns1.example.ru.\r\nstate:         REGISTERED, DELEGATED, VERIFIED\r\ncreated:       2001-01-01T00:00:00Z\r\npaid-till:     2027-01-01T00:00:00Z\r\n", "taken"],
  "de: free": ["Domain: example-free.de\r\nStatus: free\r\n", "free"],
  "de: connect": ["Domain: example.de\r\nNserver: ns1.example.de\r\nStatus: connect\r\n", "taken"],
  "be: available": ["Domain:\t\texample.be\r\nStatus:\t\tAVAILABLE\r\n", "free"],
  "be: not available": ["Domain:\t\texample.be\r\nStatus:\t\tNOT AVAILABLE\r\n\r\nRegistered:\tMon Jan 01 2001\r\n", "taken"],
  "pl: not found": ["No information available about domain name example.pl in the Registry NASK database.\r\n", "free"],
  "rate limit": ["Query limit exceeded. Try again later.\r\n", "limited"],
  "unknown format": ["Something completely unexpected happened here.\r\n", "unknown"],
};

describe("classifyWhois", () => {
  for (const [name, [text, expected]] of Object.entries(SAMPLES)) {
    test(name, () => expect(classifyWhois(text)).toBe(expected));
  }

  test("a long response with 'not found' in the footer is not treated as free", () => {
    expect(classifyWhois("Terms of use... not found ... " + "x".repeat(7000))).toBe("unknown");
  });
});

describe("tcpQuery (local server)", () => {
  test("sends the query and reads the response until the connection closes", async () => {
    let received = "";
    const server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        data(s, d) {
          received += d.toString();
          s.write('No match for "X.TEST".\r\n');
          s.end();
        },
      },
    });
    const out = await tcpQuery("127.0.0.1", server.port, "x.test\r\n", 2000);
    server.stop(true);
    expect(received).toBe("x.test\r\n");
    expect(out).toContain("No match");
  });

  test("returns partial data after a timeout", async () => {
    const server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: { data(s) { s.write("partial"); /* never close */ } },
    });
    const out = await tcpQuery("127.0.0.1", server.port, "q\r\n", 300);
    server.stop(true);
    expect(out).toBe("partial");
  });

  test("a connection error rejects", async () => {
    await expect(tcpQuery("127.0.0.1", 1, "q\r\n", 1000)).rejects.toBeDefined();
  });
});
