import type { Evidence, Status, Verdict } from "./types";

const names = (es: Evidence[]) => es.map((e) => e.source).join(", ");

/**
 * Pure function: evidence -> verdict. Rules:
 *  - any evidence of registration (RDAP 200, WHOIS record, NS in DNS) => taken;
 *  - "free" only when at least 2 independent sources say so and none objects;
 *  - NXDOMAIN in DNS is a weak vote: it never suffices alone and never contradicts the registry
 *    (a domain registered without delegation also returns NXDOMAIN);
 *  - errors, timeouts and "TLD not supported" carry no vote and never mean "free".
 */
export function decide(input: string, domain: string, evidence: Evidence[]): Verdict {
  const taken = evidence.filter((e) => e.vote === "taken");
  const free = evidence.filter((e) => e.vote === "free");
  const unavailable = evidence.filter((e) => e.vote === "unavailable");
  const registryFree = free.filter((e) => e.source !== "dns");
  const dnsFree = free.some((e) => e.source === "dns");
  const registrarFree = free.some((e) => e.source === "porkbun" || e.source === "cloudflare");
  const notes = [...new Set(evidence.flatMap((e) => e.notes ?? []))];

  const make = (status: Status, confidence: Verdict["confidence"], summary: string): Verdict => ({
    input,
    domain,
    status,
    confidence,
    summary,
    notes,
    evidence,
    checkedAt: new Date().toISOString(),
  });

  if (taken.length && registryFree.length) {
    return make(
      "CONFLICT",
      "low",
      `Conflicting sources: ${names(taken)} → taken, ${names(registryFree)} → free. One of the servers may be wrong; check manually.`,
    );
  }
  if (taken.length) return make("TAKEN", "high", `Taken (${names(taken)}).`);

  if (unavailable.length) {
    const extra = registryFree.length
      ? ` The registry shows no record (${names(registryFree)}), so this is most likely a reservation or block.`
      : "";
    return make("UNAVAILABLE", "medium", `The registrar refuses registration (${names(unavailable)}): taken, reserved or blocked.${extra}`);
  }

  if (registryFree.length === 0) {
    return dnsFree
      ? make("UNKNOWN", "low", 'Only DNS (NXDOMAIN) says "free". That is not enough: a domain can be registered without delegation.')
      : make("UNKNOWN", "low", "Could not determine the status (no source gave a conclusive answer).");
  }

  const tail = notes.some((n) => /premium/i.test(n)) ? " Note: premium pricing." : "";
  const n = free.length;

  if (n >= 3 || (registrarFree && registryFree.length >= 2)) {
    return make("AVAILABLE", "high", `Available, confirmed by: ${names(free)}.${tail}`);
  }
  if (n === 2) {
    return registrarFree
      ? make("AVAILABLE", "medium", `Available according to ${names(free)}.${tail}`)
      : make("LIKELY_AVAILABLE", "medium", `Likely available according to ${names(free)}; not checked with a registrar.${tail}`);
  }
  return make("UNKNOWN", "low", `Only ${names(free)} says "free"; no confirmation from a second source.`);
}
