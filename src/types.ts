export type Source = "rdap" | "whois" | "dns" | "porkbun" | "cloudflare";

/** What a single source says. "unknown" = no vote (error, timeout, unsupported TLD). */
export type Vote = "taken" | "free" | "unavailable" | "unknown";

export interface Evidence {
  source: Source;
  vote: Vote;
  detail: string;
  notes?: string[];
}

export type Status =
  | "AVAILABLE"
  | "LIKELY_AVAILABLE"
  | "TAKEN"
  | "UNAVAILABLE"
  | "CONFLICT"
  | "UNKNOWN"
  | "INVALID";

export interface Verdict {
  input: string;
  domain: string;
  status: Status;
  confidence: "high" | "medium" | "low";
  summary: string;
  notes: string[];
  evidence: Evidence[];
  checkedAt: string;
}

export interface Domain {
  input: string;
  ascii: string;
  label: string;
  tld: string;
}
