import crypto from "node:crypto";

export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;

export const sha1 = (s: string) => crypto.createHash("sha1").update(s).digest("hex");
export const shortHash = (s: string) => sha1(s).slice(0, 12);

/** YYYY-MM-DD for a date in IST. */
export function istDate(d: Date = new Date()): string {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** ISO week key (e.g. 2026-W41) computed in IST, used for run idempotency (G19). */
export function isoWeekKey(d: Date = new Date()): string {
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  const t = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Whole days between `published` and `now`, measured on IST calendar days. */
export function ageInIstDays(published: Date, now: Date = new Date()): number {
  const a = Date.parse(istDate(published));
  const b = Date.parse(istDate(now));
  return Math.round((b - a) / DAY_MS);
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
  ndash: "–", mdash: "—", hellip: "…", rupee: "₹",
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

export function cleanText(s: string | null | undefined): string {
  if (!s) return "";
  return decodeEntities(decodeEntities(String(s)).replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/** Normalise text for substring comparisons (quotes, dashes, whitespace, case). */
export function normForMatch(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[‘’‛′`]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/…/g, "...")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const TRACKING = /^(utm_|fbclid|gclid|mc_|ref$|ref_|ocid|cmpid|oc$|ito$|_ga)/i;

/** Canonical URL for dedupe: lowercase host, no www, no tracking params, no hash, no trailing slash. */
export function canonicalUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
    u.searchParams.sort();
    let s = `${u.protocol}//${u.hostname}${u.pathname.replace(/\/(amp|amp\.html)$/i, "").replace(/\/+$/, "")}`;
    const q = u.searchParams.toString();
    if (q) s += `?${q}`;
    return s;
  } catch {
    return raw.trim();
  }
}

export function isHttpUrl(s: unknown): s is string {
  if (typeof s !== "string") return false;
  try {
    const u = new URL(s);
    return (u.protocol === "http:" || u.protocol === "https:") && !!u.hostname && u.hostname.includes(".");
  } catch {
    return false;
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

const STOP = new Set(
  "a an the of for to in on and or with by at from as is are be its it this that into over under after new will has have says said".split(" "),
);

export function tokens(s: string): Set<string> {
  return new Set(
    normForMatch(s)
      .replace(/[^a-z0-9₹ ]+/g, " ")
      .split(" ")
      .filter((w) => w.length > 1 && !STOP.has(w)),
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Word-boundary-ish phrase test, case-insensitive. Handles short acronyms like "ITI", "MCA", "RFP". */
export function containsPhrase(haystack: string, phrase: string): boolean {
  const p = phrase.trim();
  if (!p) return false;
  const re = new RegExp(`(^|[^a-z0-9])${escapeRegex(p.toLowerCase())}([^a-z0-9]|$)`, "i");
  return re.test(haystack.toLowerCase());
}

export async function fetchWithTimeout(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const { timeoutMs = 10_000, ...rest } = init;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...rest,
      signal: ctrl.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; CSRPartnershipRadar/1.0)",
        Accept: "application/rss+xml, application/xml, application/json, text/html;q=0.8, */*;q=0.5",
        ...(rest.headers ?? {}),
      },
      cache: "no-store",
    });
  } finally {
    clearTimeout(t);
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/** Strip anything that looks like a secret before logging (G7). */
export function redact(s: string): string {
  let out = s;
  for (const k of ["GEMINI_API_KEY", "RESEND_API_KEY", "UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_TOKEN", "CRON_SECRET", "ADMIN_TOKEN", "NEWSAPI_KEY"]) {
    const v = process.env[k];
    if (v && v.length > 6) out = out.split(v).join(`[${k}]`);
  }
  return out.replace(/([?&](key|apiKey|token)=)[^&\s]+/gi, "$1[redacted]");
}
