/**
 * Step 7 — verify evidence + deterministic scoring. No LLM in here.
 */
import type { AppConfig, Article, Classification, ScoredItem, ScoreBreakdown, Verdict } from "../types";
import { enabledSectors } from "../config";
import { ageInIstDays, containsPhrase, hostOf, normForMatch } from "../util";
import { PARTNER_SEARCH_RE } from "./rules";
import { indiaHint, otherIndianPlaces } from "./clean";

/** G2: evidence must be an exact (case/whitespace/quote-insensitive) substring of title + snippet. */
export function verifyEvidence(evidence: string | null, a: Pick<Article, "title" | "snippet">): boolean {
  if (!evidence || evidence.trim().length < 8) return false;
  const hay = normForMatch(`${a.title} ${a.snippet}`);
  const needle = normForMatch(evidence).replace(/^["'“]+|["'”.…]+$/g, "");
  if (!needle) return false;
  if (hay.includes(needle)) return true;
  // Allow the quote to span title→snippet boundary punctuation (e.g. "Title. Snippet").
  return normForMatch(`${a.title}. ${a.snippet}`).includes(needle);
}

/** Map LLM geo mentions (and, failing that, the article text) to configured geo tiers using aliases — in code. */
export function resolveGeo(cls: Classification, a: Article, config: AppConfig) {
  const geos = [...config.geographies].sort((x, y) => x.tier - y.tier);
  const text = `${a.title} ${a.snippet}`;
  // Only trust mentions that actually occur in the source text (no fabricated geography).
  const fromMentions = (cls.geo_mentions ?? []).filter((m) => normForMatch(text).includes(normForMatch(m)));
  for (const g of geos) {
    const hit = g.aliases.some((al) => fromMentions.some((m) => containsPhrase(m, al) || containsPhrase(al, m)) || containsPhrase(text, al));
    if (hit && g.id !== "pan_india") return { id: g.id, label: g.label, tier: g.tier };
  }
  // India confirmed but no specific region → Pan-India; a specific state outside the configured regions → unknown tier.
  const others = otherIndianPlaces(text, config);
  const pan = geos.find((g) => g.id === "pan_india") ?? geos[geos.length - 1];
  if (others.length) return { id: "other_india", label: others[0], tier: 0 };
  if (pan && indiaHint(a, config)) return { id: pan.id, label: pan.label, tier: pan.tier };
  return null;
}

export function credibilityOf(a: Article, config: AppConfig): "high" | "medium" | "low" {
  const host = hostOf(a.url) === "news.google.com" ? a.source.toLowerCase() : hostOf(a.url) || a.source.toLowerCase();
  const match = (list: string[]) => list.some((d) => host === d || host.endsWith(`.${d}`) || a.source.toLowerCase().includes(d));
  if (match(config.source_credibility.high)) return "high";
  if (match(config.source_credibility.medium)) return "medium";
  return "low";
}

function recencyPoints(ageDays: number, recency: Record<string, number>): number {
  for (const [k, v] of Object.entries(recency)) {
    const m = /^(\d+)-(\d+)d$/.exec(k);
    if (m && ageDays >= Number(m[1]) && ageDays <= Number(m[2])) return v;
  }
  return 0;
}

function watchlistMatch(cls: Classification, a: Article, config: AppConfig): string | null {
  const text = `${cls.company ?? ""} ${a.title} ${a.snippet}`;
  for (const c of config.watchlist) if ([c.name, ...c.aliases].some((n) => n.length > 2 && containsPhrase(text, n))) return c.name;
  return null;
}

/** Map whatever the model put in primary_sector (id or label) to a configured, enabled sector id. */
export function resolveSector(raw: string | null, config: AppConfig): string | null {
  if (!raw) return null;
  const r = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const s = enabledSectors(config).find((x) => x.id === r || x.label.toLowerCase().replace(/[\s-]+/g, "_") === r);
  return s?.id ?? null;
}

export interface ScoreContext {
  now?: Date;
  /** company-key → bounded adjustment learned from Ananya's feedback (−5..+5). */
  feedbackAdjust?: Record<string, number>;
}

export function companyKey(company: string | null): string {
  return (company ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").slice(0, 2).join(" ");
}

export function scoreItem(a: Article, cls: Classification, config: AppConfig, ctx: ScoreContext = {}): ScoredItem {
  const now = ctx.now ?? new Date();
  const sc = config.scoring;
  const verified = verifyEvidence(cls.evidence, a);
  const injection = cls.injection_flag || !!a.injectionSuspected;
  const geo = resolveGeo(cls, a, config);
  const primary = resolveSector(cls.primary_sector, config);
  const secondary = (cls.secondary_sectors ?? []).map((s) => resolveSector(s, config)).filter(Boolean) as string[];
  const sectorId = primary ?? secondary[0] ?? null;
  const sectorLabel = enabledSectors(config).find((s) => s.id === sectorId)?.label ?? null;
  const credibility = credibilityOf(a, config);
  const wl = watchlistMatch(cls, a, config);
  const age = ageInIstDays(new Date(a.publishedAt), now);
  const reasons: string[] = [];

  let signal = cls.signal;
  // G4: PARTNER_SEARCH needs explicit seeking language in the source text ("partners with X" does not count).
  if (signal === "PARTNER_SEARCH" && !PARTNER_SEARCH_RE.test(`${a.title}. ${a.snippet}`)) {
    signal = "NEW_INITIATIVE";
    reasons.push("no explicit partner-seeking language in source → treated as NEW_INITIATIVE");
  }
  // G12: non-policy items must be in an enabled focus sector.
  if (signal !== "IRRELEVANT" && signal !== "POLICY" && !sectorId) {
    signal = "IRRELEVANT";
    reasons.push("not in an enabled focus sector");
  }

  const breakdown: ScoreBreakdown = {
    signal: signal === "IRRELEVANT" ? 0 : sc.signal_weight[signal],
    sector: primary ? sc.sector_match.primary : secondary.length ? sc.sector_match.secondary : 0,
    geo: geo && geo.tier > 0 ? (sc.geo_weight[String(geo.tier)] ?? sc.geo_weight.unknown ?? 0) : (sc.geo_weight.unknown ?? 0),
    recency: recencyPoints(Math.max(0, age), sc.recency),
    watchlist: wl ? sc.watchlist_bonus : 0,
    credibility: sc.source_credibility[credibility] ?? 0,
    evidencePenalty: verified ? 0 : sc.unverified_evidence_penalty,
    feedback: Math.max(-5, Math.min(5, ctx.feedbackAdjust?.[companyKey(cls.company)] ?? 0)),
  };
  const score = signal === "IRRELEVANT" ? 0 : Object.values(breakdown).reduce((x, y) => x + y, 0);

  let verdict: Verdict = score >= sc.verdict_thresholds.CALL ? "CALL" : score >= sc.verdict_thresholds.WATCH ? "WATCH" : "SKIP";
  if (signal === "IRRELEVANT") {
    verdict = "SKIP";
    reasons.push(cls.one_line_summary ? `irrelevant: ${cls.one_line_summary}` : "irrelevant");
  }

  // Rule: PARTNER_SEARCH with verified evidence in a focus sector is always at least WATCH.
  if (signal === "PARTNER_SEARCH" && verified && primary && verdict === "SKIP") {
    verdict = "WATCH";
    reasons.push("verified partner search is always at least WATCH");
  }
  // G2: unverified evidence can never be CALL.
  if (!verified && verdict === "CALL") {
    verdict = "WATCH";
    reasons.push("evidence not found verbatim in source → capped at WATCH");
  }
  if (!verified && signal !== "IRRELEVANT") reasons.push("evidence unverified (−25)");
  // G14: low confidence can never be CALL.
  if (cls.confidence < 0.6 && verdict === "CALL") {
    verdict = "WATCH";
    reasons.push(`confidence ${cls.confidence.toFixed(2)} < 0.6 → capped at WATCH`);
  }
  // G6: injection attempt caps at WATCH.
  if (injection && verdict === "CALL") {
    verdict = "WATCH";
    reasons.push("prompt-injection text detected → capped at WATCH");
  }

  const section: ScoredItem["section"] =
    signal === "POLICY" && signal === cls.signal ? (verified || cls.confidence >= 0.6 ? "POLICY" : "SKIP") : verdict;

  return {
    id: a.id,
    article: a,
    cls: { ...cls, signal, injection_flag: injection },
    verified,
    geo,
    sectorLabel,
    credibility,
    watchlistMatch: wl,
    score,
    breakdown,
    verdict,
    verdictReasons: reasons,
    section,
  };
}
