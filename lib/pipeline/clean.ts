/**
 * Deterministic stages (no LLM): normalise → 7-day window → dedupe → keyword pre-filter.
 */
import type { AppConfig, Article, RawArticle, SkippedItem } from "../types";
import { enabledSectors } from "../config";
import { ageInIstDays, canonicalUrl, cleanText, containsPhrase, hostOf, isHttpUrl, jaccard, shortHash, tokens } from "../util";
import { detectInjection } from "./injection";

/* ------------------------------- normalise ------------------------------- */
export function normalize(raw: RawArticle[]): { articles: Article[]; dropped: SkippedItem[] } {
  const articles: Article[] = [];
  const dropped: SkippedItem[] = [];
  for (const r of raw) {
    const title = cleanText(r.title);
    const url = (r.url ?? "").trim();
    // G5: every item needs a valid http(s) URL — dropped here, before anything else.
    if (!isHttpUrl(url)) {
      dropped.push({ title: title || "(untitled)", url, source: r.sourceName, reason: "no valid source URL" });
      continue;
    }
    if (!title) {
      dropped.push({ title: "(untitled)", url, source: r.sourceName, reason: "empty title" });
      continue;
    }
    const d = r.publishedAt ? new Date(r.publishedAt) : null;
    if (!d || Number.isNaN(d.getTime())) {
      dropped.push({ title, url, source: r.sourceName, reason: "no parseable publish date" });
      continue;
    }
    const canon = canonicalUrl(url);
    const snippet = cleanText(r.snippet);
    const a: Article = {
      id: r.fixtureId ?? `a_${shortHash(canon)}`,
      title,
      snippet,
      url,
      canonicalUrl: canon,
      source: (r.source && r.source.trim()) || hostOf(url),
      publishedAt: d.toISOString(),
      fetchedFrom: [r.sourceName],
      alsoReportedBy: [],
      demo: !!r.demo,
      fixtureId: r.fixtureId,
    };
    a.injectionSuspected = detectInjection(`${a.title} ${a.snippet}`);
    articles.push(a);
  }
  return { articles, dropped };
}

/* ---------------------------- 7-day window (G10) ---------------------------- */
export function filterByDate(articles: Article[], lookbackDays: number, now: Date = new Date()) {
  const kept: Article[] = [];
  const dropped: SkippedItem[] = [];
  for (const a of articles) {
    const age = ageInIstDays(new Date(a.publishedAt), now);
    if (age < 0 && new Date(a.publishedAt).getTime() - now.getTime() > 36e5) {
      dropped.push({ title: a.title, url: a.url, source: a.source, reason: "publish date in the future" });
    } else if (age > lookbackDays) {
      dropped.push({ title: a.title, url: a.url, source: a.source, reason: `older than ${lookbackDays} days (${age}d)` });
    } else kept.push(a);
  }
  return { kept, dropped };
}

/* ------------------------------- dedupe (G11) ------------------------------- */
const TITLE_JACCARD = 0.8;

/** Rough company key from a headline: leading capitalised words before the verb. Used only for dedupe hints. */
export function headlineCompanyKey(title: string): string {
  const m = /^((?:[A-Z][\w&.'-]*\s?){1,4})/.exec(title.replace(/^(old news|exclusive|breaking):\s*/i, ""));
  return m ? m[1].trim().toLowerCase().split(/\s+/).slice(0, 2).join(" ") : "";
}

function merge(into: Article, dup: Article) {
  if (dup.url !== into.url && !into.alsoReportedBy.some((x) => x.url === dup.url)) {
    into.alsoReportedBy.push({ source: dup.source, url: dup.url });
  }
  for (const f of dup.fetchedFrom) if (!into.fetchedFrom.includes(f)) into.fetchedFrom.push(f);
  if (dup.snippet.length > into.snippet.length && !into.snippet) into.snippet = dup.snippet;
  into.injectionSuspected = into.injectionSuspected || dup.injectionSuspected;
}

/**
 * Pre-LLM dedupe:
 *  1. canonical URL hash
 *  2. title Jaccard ≥ 0.8
 *  3. same headline company + same pre-filter signal + strong title overlap (≥ 0.5) within the week
 * Earliest/most-detailed copy wins; duplicates are listed under `alsoReportedBy`.
 */
export function dedupe(articles: Article[], config?: AppConfig) {
  // Prefer items with snippets and earlier publication as the "primary" copy.
  const sorted = [...articles].sort(
    (a, b) => (b.snippet ? 1 : 0) - (a.snippet ? 1 : 0) || Date.parse(a.publishedAt) - Date.parse(b.publishedAt),
  );
  const kept: Article[] = [];
  const byUrl = new Map<string, Article>();
  const toks = new Map<Article, Set<string>>();
  const mergedIds: { id: string; into: string }[] = [];

  for (const a of sorted) {
    const existing = byUrl.get(a.canonicalUrl);
    if (existing) {
      merge(existing, a);
      mergedIds.push({ id: a.id, into: existing.id });
      continue;
    }
    const ta = tokens(a.title);
    const ca = headlineCompanyKey(a.title);
    const sa = config ? topSignal(a, config) : null;
    let dupOf: Article | undefined;
    for (const k of kept) {
      const j = jaccard(ta, toks.get(k)!);
      if (j >= TITLE_JACCARD) {
        dupOf = k;
        break;
      }
      if (ca && ca === headlineCompanyKey(k.title) && sa && sa === (config ? topSignal(k, config) : null) && j >= 0.5) {
        dupOf = k;
        break;
      }
    }
    if (dupOf) {
      merge(dupOf, a);
      mergedIds.push({ id: a.id, into: dupOf.id });
      continue;
    }
    kept.push(a);
    toks.set(a, ta);
    byUrl.set(a.canonicalUrl, a);
  }
  return { kept, mergedIds };
}

/** Post-classification dedupe: same company + same signal within the window → merge (G11, third rule). */
export function sameCompanySignalKey(company: string | null, signal: string): string | null {
  if (!company) return null;
  const c = company
    .toLowerCase()
    .replace(/\b(ltd|limited|pvt|private|inc|corp|corporation|group|india|the|company|co)\b\.?/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 2)
    .join(" ");
  return c ? `${c}|${signal}` : null;
}

/* -------------------------- keyword pre-filter -------------------------- */
function topSignal(a: Article, config: AppConfig): string | null {
  const text = `${a.title} ${a.snippet}`;
  let best: string | null = null;
  let bestN = 0;
  for (const [sig, kws] of Object.entries(config.signal_keywords)) {
    const n = kws.filter((k) => containsPhrase(text, k)).length;
    if (n > bestN) {
      bestN = n;
      best = sig;
    }
  }
  return best;
}

export interface PrefilterHit {
  sectorHits: number;
  csrHits: number;
  signalHits: number;
  geoTier: number | null;
  watchlist: boolean;
  score: number;
}

const INDIA_RE =
  /(₹|\bRs\.?\s?\d|\b(?:INR|crore|lakh|India|Indian|Bharat|NITI|MCA|Andhra|Arunachal|Assam|Bihar|Chhattisgarh|Goa|Gujarat|Haryana|Himachal|Jharkhand|Karnataka|Kerala|Madhya Pradesh|Maharashtra|Manipur|Meghalaya|Mizoram|Nagaland|Odisha|Punjab|Rajasthan|Sikkim|Tamil Nadu|Telangana|Tripura|Uttar Pradesh|Uttarakhand|West Bengal|Delhi|Jammu|Kashmir|Ladakh|Puducherry|Chandigarh|Mumbai|Pune|Bengaluru|Bangalore|Hyderabad|Chennai|Kolkata|Ahmedabad|Lucknow|Jaipur|Nagpur|Nashik|Indore|Bhopal|Surat|Kochi|Noida|Gurugram|Gurgaon)\b)/;
const FOREIGN_RE =
  /(\$\s?\d|\bUS\$|\bUSD\b|£|€|\b(U\.S\.|USA|United States|U\.K\.|UK|Britain|British|London|Manchester|Canada|Canadian|Australia|Australian|County|Missouri|Utah|Texas|California|Ohio|Florida|Georgia|Michigan|Minnesota|Nigeria|Kenya|Pakistan|Bangladesh|Sri Lanka|Nepal|Philippines|Singapore|Dubai|UAE)\b)/;

const ACTION_RE = /\b(launch\w*|announc\w*|unveil\w*|expand\w*|partner\w*|fund(s|ed|ing)?|support(s|ed|ing)?|sign(s|ed)?|MoU|commit\w*|pledg\w*|inaugurat\w*|invit\w*|seek\w*|sponsor\w*|donat\w*|adopt\w*)\b/i;

const INDIAN_PLACES_RE = new RegExp(INDIA_RE.source.replace(/INR\|crore\|lakh\|India\|Indian\|Bharat\|NITI\|MCA\|/, ""), "g");

/** Indian states/cities mentioned that are NOT covered by any configured geography alias. */
export function otherIndianPlaces(text: string, config: AppConfig): string[] {
  const found = [...text.matchAll(INDIAN_PLACES_RE)].map((m) => m[0]).filter((p) => !/^(₹|Rs)/.test(p));
  return [...new Set(found)].filter((p) => !config.geographies.some((g) => g.aliases.some((al) => al.toLowerCase() === p.toLowerCase())));
}

/** Deterministic India check (G12): explicit Indian place/currency/entity, an Indian publisher domain, or a configured geo alias. */
export function indiaHint(a: Pick<Article, "title" | "snippet" | "url" | "source">, config: AppConfig): boolean {
  const text = `${a.title} ${a.snippet}`;
  if (INDIA_RE.test(text)) return true;
  if (config.geographies.some((g) => g.aliases.some((al) => containsPhrase(text, al)))) return true;
  const host = hostOf(a.url) === "news.google.com" ? a.source.toLowerCase() : hostOf(a.url);
  if (/\.in$/.test(host) || [...config.source_credibility.high, ...config.source_credibility.medium].some((d) => host.endsWith(d))) return true;
  return false;
}
export const foreignHint = (a: Pick<Article, "title" | "snippet">) => FOREIGN_RE.test(`${a.title} ${a.snippet}`);

export function prefilterScore(a: Article, config: AppConfig): PrefilterHit {
  const text = `${a.title} ${a.snippet}`;
  const sectorHits = enabledSectors(config).reduce((n, s) => n + s.keywords.filter((k) => containsPhrase(text, k)).length, 0);
  const csrHits = config.csr_anchor_terms.filter((k) => containsPhrase(text, k)).length;
  const signalHits = Object.values(config.signal_keywords)
    .flat()
    .filter((k) => containsPhrase(text, k)).length;
  const policyHits = config.signal_keywords.POLICY.filter((k) => containsPhrase(text, k)).length;
  let geoTier: number | null = null;
  for (const g of config.geographies) if (g.aliases.some((al) => containsPhrase(text, al))) geoTier = Math.min(geoTier ?? 99, g.tier);
  const watchlist = config.watchlist.some((c) => [c.name, ...c.aliases].some((n) => containsPhrase(text, n)));
  const score =
    sectorHits * 3 + csrHits * 4 + signalHits * 2 + policyHits * 2 + (geoTier ? 5 - Math.min(geoTier, 4) : 0) + (watchlist ? 3 : 0);
  return { sectorHits, csrHits, signalHits, geoTier, watchlist, score };
}

/**
 * Keep items that look like CSR + (focus sector or CSR-policy). Then cap at max_items_to_llm,
 * keeping the highest pre-filter scores (G17).
 */
export function prefilter(articles: Article[], config: AppConfig) {
  const kept: Article[] = [];
  const dropped: SkippedItem[] = [];
  for (const a of articles) {
    const h = prefilterScore(a, config);
    a.prefilterScore = h.score;
    const policyLike = config.signal_keywords.POLICY.filter((k) => containsPhrase(`${a.title} ${a.snippet}`, k)).length >= 1 && h.csrHits > 0;
    const action = ACTION_RE.test(`${a.title} ${a.snippet}`);
    const relevant = (h.sectorHits > 0 && (h.csrHits > 0 || h.signalHits > 0 || h.watchlist || action)) || policyLike;
    const india = indiaHint(a, config);
    if (!relevant) dropped.push({ title: a.title, url: a.url, source: a.source, reason: "keyword pre-filter: no CSR + focus-sector terms" });
    else if (!india && foreignHint(a)) dropped.push({ title: a.title, url: a.url, source: a.source, reason: "not India (foreign place/currency, no Indian marker)" });
    else {
      if (!india) a.prefilterScore = h.score - 6; // unclear geography: let the classifier decide, but rank lower
      kept.push(a);
    }
  }
  kept.sort((x, y) => (y.prefilterScore ?? 0) - (x.prefilterScore ?? 0));
  const cap = Math.min(config.limits.max_items_to_llm, 120);
  const overCap = kept.slice(cap);
  for (const a of overCap) dropped.push({ title: a.title, url: a.url, source: a.source, reason: `over LLM cap (${cap})` });
  return { kept: kept.slice(0, cap), dropped };
}
