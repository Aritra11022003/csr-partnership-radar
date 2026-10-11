import type { AppConfig, Signal } from "../types";
import { enabledSectors } from "../config";

export interface SearchQuery {
  q: string;
  kind: "sector_signal" | "geo" | "policy" | "watchlist";
  sector?: string;
  signal?: Signal;
}

const quote = (s: string) => (/\s|-/.test(s) ? `"${s}"` : s);
const anyOf = (terms: string[]) => (terms.length === 1 ? quote(terms[0]) : `(${terms.map(quote).join(" OR ")})`);

/** Pure: config → list of search queries. Changing sectors/geos/watchlist in /settings changes this output. */
export function buildQueries(config: AppConfig): SearchQuery[] {
  const sectors = enabledSectors(config);
  const csr = anyOf(config.csr_anchor_terms.slice(0, 3));
  const out: SearchQuery[] = [];

  // 1. sector × signal (the core grid)
  const signals: Exclude<Signal, "IRRELEVANT" | "POLICY">[] = ["PARTNER_SEARCH", "NEW_INITIATIVE", "ALLOCATION_UP"];
  for (const signal of signals) {
    for (const s of sectors) {
      const sig = config.signal_keywords[signal].slice(0, 4);
      out.push({ q: `${csr} ${anyOf(s.keywords.slice(0, 4))} ${anyOf(sig)}`, kind: "sector_signal", sector: s.id, signal });
    }
  }

  // 2. geography-first queries for the top two tiers (Pune, Maharashtra by default)
  const allSectorTerms = sectors.flatMap((s) => s.keywords.slice(0, 2));
  for (const g of [...config.geographies].sort((a, b) => a.tier - b.tier).filter((g) => g.tier <= 2)) {
    out.push({ q: `CSR ${anyOf(allSectorTerms.slice(0, 6))} ${anyOf(g.aliases.slice(0, 4))}`, kind: "geo" });
  }

  // 3. policy
  for (const p of config.policy_queries) out.push({ q: p, kind: "policy", signal: "POLICY" });
  out.push({ q: "site:mca.gov.in CSR", kind: "policy", signal: "POLICY" });

  // 4. watchlist companies, batched 6 per query
  const names = config.watchlist.map((c) => c.aliases.find((a) => /foundation/i.test(a)) ?? c.name);
  for (let i = 0; i < names.length; i += 6) {
    out.push({ q: `${anyOf(names.slice(i, i + 6))} (CSR OR education OR skilling)`, kind: "watchlist" });
  }

  // De-duplicate and cap (cost/time guard).
  const seen = new Set<string>();
  return out.filter((q) => (seen.has(q.q) ? false : (seen.add(q.q), true))).slice(0, config.limits.max_queries);
}

export function googleNewsUrl(q: string, lookbackDays: number) {
  const query = `${q} when:${lookbackDays}d`;
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;
}

/** GDELT needs simpler syntax (OR groups in parentheses, no site:). A few broad queries only — it rate limits hard. */
export function buildGdeltQueries(config: AppConfig): string[] {
  const sectors = enabledSectors(config);
  const sectorTerms = sectors.flatMap((s) => s.keywords.slice(0, 2)).slice(0, 6);
  const g = (t: string[]) => `(${t.map((x) => (/\s/.test(x) ? `"${x}"` : x)).join(" OR ")})`;
  return [
    `${g(["CSR", "corporate social responsibility"])} ${g(sectorTerms)}`,
    `${g(["CSR", "corporate social responsibility"])} ${g(["implementation partner", "NGO partners", "call for proposals", "expression of interest"])}`,
  ];
}
