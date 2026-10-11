export const SIGNALS = ["PARTNER_SEARCH", "NEW_INITIATIVE", "ALLOCATION_UP", "POLICY", "IRRELEVANT"] as const;
export type Signal = (typeof SIGNALS)[number];
export type Verdict = "CALL" | "WATCH" | "SKIP";

export interface SectorConfig {
  id: string;
  label: string;
  enabled: boolean;
  keywords: string[];
}

export interface GeoConfig {
  id: string;
  label: string;
  tier: number;
  aliases: string[];
}

export interface WatchlistCompany {
  name: string;
  aliases: string[];
  hq_geo: string;
}

export interface ScoringConfig {
  signal_weight: Record<Exclude<Signal, "IRRELEVANT">, number>;
  sector_match: { primary: number; secondary: number };
  geo_weight: Record<string, number>;
  recency: Record<string, number>;
  watchlist_bonus: number;
  source_credibility: { high: number; medium: number; low: number };
  unverified_evidence_penalty: number;
  verdict_thresholds: { CALL: number; WATCH: number };
  rules?: string[];
}

export interface AppConfig {
  org: { name: string; focus_beneficiaries: string[]; recipients: string[] };
  lookback_days: number;
  sectors: SectorConfig[];
  csr_anchor_terms: string[];
  signal_keywords: Record<Exclude<Signal, "IRRELEVANT">, string[]>;
  geographies: GeoConfig[];
  scoring: ScoringConfig;
  source_credibility: { high: string[]; medium: string[]; low_default: boolean };
  sector_feeds: { name: string; url: string; verify: boolean; enabled?: boolean }[];
  policy_queries: string[];
  limits: { max_queries: number; max_items_to_llm: number; llm_batch_size: number; max_digest_items: number };
  watchlist: WatchlistCompany[];
}

/** One article as it comes out of a source fetcher, before normalisation. */
export interface RawArticle {
  title: string;
  snippet?: string;
  url: string;
  source?: string;
  publishedAt?: string | Date | null;
  sourceName: string; // which fetcher produced it
  query?: string;
  demo?: boolean;
  fixtureId?: string;
}

/** Normalised candidate article. */
export interface Article {
  id: string;
  title: string;
  snippet: string;
  url: string;
  canonicalUrl: string;
  source: string; // publisher domain or name
  publishedAt: string; // ISO
  fetchedFrom: string[];
  alsoReportedBy: { source: string; url: string }[];
  demo: boolean;
  fixtureId?: string;
  prefilterScore?: number;
  injectionSuspected?: boolean;
}

export interface Classification {
  id: string;
  signal: Signal;
  company: string | null;
  primary_sector: string | null;
  secondary_sectors: string[];
  geo_mentions: string[];
  amount_inr_crore: number | null;
  beneficiaries: string | null;
  deadline: string | null;
  evidence: string | null;
  one_line_summary: string;
  confidence: number;
  injection_flag: boolean;
  classifiedBy: "gemini" | "rules";
}

export interface ScoreBreakdown {
  signal: number;
  sector: number;
  geo: number;
  recency: number;
  watchlist: number;
  credibility: number;
  evidencePenalty: number;
  feedback: number;
}

export interface ScoredItem {
  id: string;
  article: Article;
  cls: Classification;
  verified: boolean;
  geo: { id: string; label: string; tier: number } | null;
  sectorLabel: string | null;
  credibility: "high" | "medium" | "low";
  watchlistMatch: string | null;
  score: number;
  breakdown: ScoreBreakdown;
  verdict: Verdict;
  verdictReasons: string[];
  section: "CALL" | "WATCH" | "POLICY" | "SKIP";
}

export interface DigestItemText {
  id: string;
  headline: string;
  context: string;
  why_now: string;
  suggested_angle: string;
}

export interface DigestItem extends DigestItemText {
  company: string | null;
  signal: Signal;
  sector: string | null;
  geo: string | null;
  score: number;
  verdict: Verdict;
  evidence: string;
  verified: boolean;
  url: string;
  source: string;
  publishedAt: string;
  amount_inr_crore: number | null;
  beneficiaries: string | null;
  deadline: string | null;
  alsoReportedBy: { source: string; url: string }[];
  injection_flag: boolean;
  demo: boolean;
  confidence: number;
}

export interface SourceStatus {
  name: string;
  ok: boolean;
  count: number;
  ms: number;
  error?: string;
}

export interface SkippedItem {
  title: string;
  url: string;
  source: string;
  reason: string;
}

export interface Digest {
  id: string; // YYYY-MM-DD (IST) of the run — one digest per day at most, /digest/[date]
  week: string; // ISO week key e.g. 2026-W41 (email idempotency)
  date: string;
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  week_summary: string;
  call: DigestItem[];
  watch: DigestItem[];
  policy: (DigestItem & { note: string })[];
  skipped: SkippedItem[];
  stats: {
    fetched: number;
    afterDate: number;
    afterDedupe: number;
    afterPrefilter: number;
    sentToLlm: number;
    classifiedByLlm: number;
    classifiedByRules: number;
    sources: number;
    injectionFlags: number;
    unverified: number;
  };
  sourceStatus: SourceStatus[];
  writer: "gemini" | "template";
  model: string | null;
  demo: boolean;
  quiet: boolean;
  warnings: string[];
  emailed?: { at: string; to: string[]; id?: string; error?: string };
}

export type FeedbackKind = "up" | "down" | "called";
export interface Feedback {
  itemId: string;
  digestId: string;
  kind: FeedbackKind;
  company: string | null;
  signal: string | null;
  at: string;
}
