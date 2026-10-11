/**
 * Deterministic rule-based classifier. Used when Gemini is unavailable, returns malformed output twice,
 * or omits an id. Deliberately conservative: confidence is capped at 0.55, so a rule-classified item can
 * never be CALL (G14). A human-reviewable WATCH is the worst case.
 */
import type { AppConfig, Article, Classification, Signal } from "../types";
import { enabledSectors } from "../config";
import { containsPhrase } from "../util";
import { headlineCompanyKey, indiaHint } from "./clean";

// Explicit seeking language only (G4). "partners with" is NOT here on purpose.
export const PARTNER_SEARCH_RE =
  /\b(seek(s|ing)?|invit(es|ing|ed)|call(s|ing)? for|looking for|empanel(ment|ling|s)?|request for proposals?|RFP|EOI|expression of interest)\b[^.]{0,60}\b(partners?|NGOs?|proposals?|implementing agenc(y|ies)|organi[sz]ations)\b|\b(implementation|implementing) partners? (sought|wanted|required)\b|\bRFP\b|\bexpression of interest\b|\bcall for proposals\b/i;
const POLICY_RE = /\b(MCA|Ministry of Corporate Affairs|Companies Act|Schedule VII|CSR (Policy )?Rules|CSR-1|unspent CSR|SEBI|gazette notification)\b/i;
const ALLOC_RE = /\b(CSR (spend|budget|outlay|allocation)|earmark(ed|s)?|allocat(ed|es|ion)|doubl(e|ing|ed)|ris(e|es|en)|rose|increas(e|ed|es)|hike[sd]?)\b/i;
const INITIATIVE_RE = /\b(launch(es|ed)?|announc(es|ed)|unveil(s|ed)?|flagship|MoU|rolls? out|inaugurat(es|ed)|introduc(es|ed)|kick(s|ed)? off|signs?|partners? with|will (support|fund|set up|expand)|expand(s|ed)?|to fund)\b/i;
const NON_INDIA_RE = /\b(UK|U\.K\.|British|Britain|England|London|Manchester|USA|U\.S\.|American|Canada|Australia|Germany|Singapore|Dubai|UAE|Nigeria|Kenya|Pakistan|Bangladesh|Sri Lanka|Nepal|Philippines)\b/;
const MARKET_RE = /\b(shares?|stock|Sensex|Nifty|Q[1-4]|quarterly (profit|results?)|earnings|IPO|market cap|target price|brokerage)\b/i;
const AMOUNT_RE = /(?:₹|Rs\.?|INR)\s?([\d,]+(?:\.\d+)?)\s?(crore|cr|lakh)\b/i;

/** Return the sentence of `text` that contains the regex match — an exact substring, so evidence always verifies. */
function sentenceWith(text: string, re: RegExp): string | null {
  const m = re.exec(text);
  if (!m) return null;
  const parts = text.split(/(?<=[.!?])\s+/);
  let pos = 0;
  for (const p of parts) {
    const start = text.indexOf(p, pos);
    if (m.index >= start && m.index < start + p.length) return trimWords(p, 30);
    pos = start + p.length;
  }
  return trimWords(text, 30);
}

function trimWords(s: string, n: number) {
  const w = s.trim().split(/\s+/);
  return w.length <= n ? s.trim() : w.slice(0, n).join(" ");
}

export function ruleClassify(a: Article, config: AppConfig): Classification {
  const title = a.title;
  const text = `${a.title}. ${a.snippet}`.trim();
  const base: Classification = {
    id: a.id,
    signal: "IRRELEVANT",
    company: null,
    primary_sector: null,
    secondary_sectors: [],
    geo_mentions: [],
    amount_inr_crore: null,
    beneficiaries: null,
    deadline: null,
    evidence: null,
    one_line_summary: title,
    confidence: 0.4,
    injection_flag: !!a.injectionSuspected,
    classifiedBy: "rules",
  };

  // Sector match
  const sectorHits = enabledSectors(config)
    .map((s) => ({ id: s.id, n: s.keywords.filter((k) => containsPhrase(text, k)).length }))
    .filter((s) => s.n > 0)
    .sort((x, y) => y.n - x.n);
  base.primary_sector = sectorHits[0]?.id ?? null;
  base.secondary_sectors = sectorHits.slice(1).map((s) => s.id);

  // Geo mentions (exact aliases found in text)
  for (const g of config.geographies) for (const al of g.aliases) if (containsPhrase(text, al)) base.geo_mentions.push(al);

  const amt = AMOUNT_RE.exec(text);
  if (amt) {
    const n = Number(amt[1].replace(/,/g, ""));
    base.amount_inr_crore = /lakh/i.test(amt[2]) ? n / 100 : n;
  }

  const company = headlineCompanyKey(title) ? title.match(/^((?:[A-Z][\w&.'-]*\s?){1,4})/)?.[1]?.trim() ?? null : null;

  const isCsr = config.csr_anchor_terms.some((t) => containsPhrase(text, t));
  const pick = (signal: Signal, re: RegExp, conf: number): Classification => {
    const evidence = sentenceWith(a.title, re) ?? sentenceWith(a.snippet, re);
    if (!evidence) return base;
    return { ...base, signal, evidence, confidence: Math.min(conf, 0.55), company: signal === "POLICY" ? null : company };
  };

  if ((NON_INDIA_RE.test(text) && base.geo_mentions.length === 0) || !indiaHint(a, config)) return { ...base, one_line_summary: "Not India-focused (or India not confirmed in the text)." };
  if (MARKET_RE.test(title) && !isCsr) return { ...base, one_line_summary: "Market/earnings news without CSR content." };

  if (POLICY_RE.test(text) && isCsr) return pick("POLICY", POLICY_RE, 0.55);
  if (!base.primary_sector) return { ...base, one_line_summary: "Not in a focus sector." };
  if (PARTNER_SEARCH_RE.test(text)) return pick("PARTNER_SEARCH", PARTNER_SEARCH_RE, 0.55);
  if (ALLOC_RE.test(text) && (amt || /CSR (spend|budget|outlay)/i.test(text)) && isCsr) return pick("ALLOCATION_UP", ALLOC_RE, 0.5);
  if (INITIATIVE_RE.test(text)) return pick("NEW_INITIATIVE", INITIATIVE_RE, 0.5);
  return base;
}

