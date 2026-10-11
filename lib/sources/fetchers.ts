import Parser from "rss-parser";
import type { AppConfig, RawArticle, SourceStatus } from "../types";
import { buildGdeltQueries, buildQueries, googleNewsUrl, type SearchQuery } from "./queries";
import { cleanText, containsPhrase, fetchWithTimeout, hostOf, redact, sleep } from "../util";

export interface FetchResult {
  status: SourceStatus;
  articles: RawArticle[];
  perQuery?: { q: string; count: number; error?: string }[];
}

type GItem = { title?: string; link?: string; pubDate?: string; isoDate?: string; contentSnippet?: string; content?: string; source?: unknown; guid?: string };

const parser = new Parser<Record<string, never>, GItem>({ customFields: { item: ["source"] }, timeout: 10_000 });

async function timed(name: string, fn: () => Promise<Omit<FetchResult, "status"> & { error?: string }>): Promise<FetchResult> {
  const t0 = Date.now();
  try {
    const r = await fn();
    return {
      status: { name, ok: !r.error, count: r.articles.length, ms: Date.now() - t0, error: r.error },
      articles: r.articles,
      perQuery: r.perQuery,
    };
  } catch (e) {
    return { status: { name, ok: false, count: 0, ms: Date.now() - t0, error: redact((e as Error).message) }, articles: [] };
  }
}

/** Simple bounded concurrency map. */
async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

function gnSource(item: GItem): { name: string; url?: string } {
  const s = item.source as { _?: string; $?: { url?: string } } | string | undefined;
  if (!s) return { name: "" };
  if (typeof s === "string") return { name: s };
  return { name: s._ ?? "", url: s.$?.url };
}

/* ---------------- Google News RSS (one request per query) ---------------- */
export async function fetchGoogleNews(config: AppConfig, queries?: SearchQuery[]): Promise<FetchResult> {
  const qs = queries ?? buildQueries(config);
  return timed("Google News RSS", async () => {
    const perQuery: FetchResult["perQuery"] = [];
    const results = await pool(qs, 6, async (q) => {
      try {
        const res = await fetchWithTimeout(googleNewsUrl(q.q, config.lookback_days), { timeoutMs: 10_000 });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const feed = await parser.parseString(await res.text());
        const arts: RawArticle[] = (feed.items ?? []).map((it) => {
          const src = gnSource(it);
          let title = cleanText(it.title);
          if (src.name && title.endsWith(` - ${src.name}`)) title = title.slice(0, -(src.name.length + 3));
          // Google's description is just the linked title + publisher; keep only if it adds text.
          const desc = cleanText(it.contentSnippet || it.content);
          const snippet = desc && !desc.startsWith(title.slice(0, 40)) ? desc : "";
          return {
            title,
            snippet,
            url: it.link ?? "",
            source: src.url ? hostOf(src.url) : src.name,
            publishedAt: it.isoDate ?? it.pubDate ?? null,
            sourceName: "Google News RSS",
            query: q.q,
          };
        });
        perQuery.push({ q: q.q, count: arts.length });
        return arts;
      } catch (e) {
        perQuery.push({ q: q.q, count: 0, error: redact((e as Error).message) });
        return [];
      }
    });
    const articles = results.flat();
    const failed = perQuery.filter((p) => p.error).length;
    return {
      articles,
      perQuery,
      error: failed === qs.length && qs.length > 0 ? `all ${qs.length} queries failed` : undefined,
    };
  });
}

/* ---------------- GDELT DOC 2.0 (rate limited: 1 req / 5 s) ---------------- */
interface GdeltArticle {
  url: string;
  title: string;
  seendate: string;
  domain: string;
  sourcecountry?: string;
  language?: string;
}

function parseGdeltDate(s: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : null;
}

export async function fetchGdelt(config: AppConfig): Promise<FetchResult> {
  return timed("GDELT DOC 2.0", async () => {
    const articles: RawArticle[] = [];
    const perQuery: FetchResult["perQuery"] = [];
    const qs = buildGdeltQueries(config);
    for (let i = 0; i < qs.length; i++) {
      if (i > 0) await sleep(5_500);
      const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(qs[i])}&mode=artlist&format=json&timespan=${config.lookback_days}d&maxrecords=75&sourcecountry=IN&sort=datedesc`;
      let attempt = 0;
      for (;;) {
        try {
          const res = await fetchWithTimeout(url, { timeoutMs: 10_000 });
          const text = await res.text();
          if (res.status === 429 || text.startsWith("Please limit")) throw Object.assign(new Error("rate limited (429)"), { retry: true });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = text.trim() ? (JSON.parse(text) as { articles?: GdeltArticle[] }) : {};
          const arts = (json.articles ?? [])
            .filter((a) => !a.language || a.language === "English")
            .map<RawArticle>((a) => ({
              title: cleanText(a.title),
              snippet: "",
              url: a.url,
              source: a.domain,
              publishedAt: parseGdeltDate(a.seendate),
              sourceName: "GDELT DOC 2.0",
              query: qs[i],
            }));
          articles.push(...arts);
          perQuery.push({ q: qs[i], count: arts.length });
          break;
        } catch (e) {
          if ((e as { retry?: boolean }).retry && attempt++ < 1) {
            await sleep(5_500);
            continue;
          }
          perQuery.push({ q: qs[i], count: 0, error: redact((e as Error).message) });
          break;
        }
      }
    }
    const failed = perQuery.filter((p) => p.error);
    return { articles, perQuery, error: failed.length === qs.length ? failed[0]?.error : undefined };
  });
}

/* ---------------- Sector RSS feeds (India CSR, The CSR Journal, …) ---------------- */
export async function fetchSectorFeeds(config: AppConfig): Promise<FetchResult[]> {
  const feeds = config.sector_feeds.filter((f) => f.enabled !== false);
  return Promise.all(
    feeds.map((f) =>
      timed(f.name, async () => {
        const res = await fetchWithTimeout(f.url, { timeoutMs: 10_000, redirect: "follow" });
        if (!res.ok) throw new Error(`HTTP ${res.status} — feed disabled for this run`);
        const feed = await parser.parseString(await res.text());
        return {
          articles: (feed.items ?? []).map((it) => ({
            title: cleanText(it.title),
            snippet: cleanText(it.contentSnippet || it.content).slice(0, 600),
            url: it.link ?? "",
            source: hostOf(it.link ?? f.url),
            publishedAt: it.isoDate ?? it.pubDate ?? null,
            sourceName: f.name,
          })),
        };
      }),
    ),
  );
}

/* ---------------- PIB press releases (English national feed) ---------------- */
export async function fetchPib(config: AppConfig): Promise<FetchResult> {
  return timed("PIB press releases", async () => {
    const res = await fetchWithTimeout("https://www.pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=3&reg=3", { timeoutMs: 10_000, redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const feed = await parser.parseString(await res.text());
    const fetchedAt = new Date().toISOString();
    // PIB's RSS only lists the current day's releases and carries no pubDate, so fetch time is used as the date.
    const terms = [...config.csr_anchor_terms, ...config.signal_keywords.POLICY];
    return {
      articles: (feed.items ?? [])
        .map((it) => ({
          title: cleanText(it.title),
          snippet: cleanText(it.contentSnippet).slice(0, 600),
          url: it.link ?? "",
          source: "pib.gov.in",
          publishedAt: it.isoDate ?? it.pubDate ?? fetchedAt,
          sourceName: "PIB press releases",
        }))
        .filter((a) => terms.some((t) => containsPhrase(`${a.title} ${a.snippet}`, t))),
    };
  });
}

/* ---------------- Optional: NewsAPI (only if NEWSAPI_KEY is set) ---------------- */
export async function fetchNewsApi(config: AppConfig): Promise<FetchResult | null> {
  const key = process.env.NEWSAPI_KEY;
  if (!key) return null;
  return timed("NewsAPI", async () => {
    const from = new Date(Date.now() - config.lookback_days * 864e5).toISOString().slice(0, 10);
    const q = '(CSR OR "corporate social responsibility") AND (education OR skilling OR "skill development" OR "digital literacy") AND India';
    const res = await fetchWithTimeout(
      `https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&from=${from}&language=en&pageSize=100&sortBy=publishedAt`,
      { timeoutMs: 10_000, headers: { "X-Api-Key": key } },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { articles?: { title: string; description?: string; url: string; source?: { name?: string }; publishedAt?: string }[] };
    return {
      articles: (json.articles ?? []).map((a) => ({
        title: cleanText(a.title),
        snippet: cleanText(a.description),
        url: a.url,
        source: hostOf(a.url) || a.source?.name,
        publishedAt: a.publishedAt ?? null,
        sourceName: "NewsAPI",
      })),
    };
  });
}

/** Fetch every live source in parallel. One failing source never kills the run (G15). */
export async function fetchAllLive(config: AppConfig): Promise<FetchResult[]> {
  const settled = await Promise.allSettled([
    fetchGoogleNews(config),
    fetchGdelt(config),
    fetchSectorFeeds(config),
    fetchPib(config),
    fetchNewsApi(config),
  ]);
  const out: FetchResult[] = [];
  const names = ["Google News RSS", "GDELT DOC 2.0", "Sector feeds", "PIB press releases", "NewsAPI"];
  settled.forEach((s, i) => {
    if (s.status === "fulfilled") {
      if (Array.isArray(s.value)) out.push(...s.value);
      else if (s.value) out.push(s.value);
    } else {
      out.push({ status: { name: names[i], ok: false, count: 0, ms: 0, error: redact(String(s.reason)) }, articles: [] });
    }
  });
  return out;
}

/* ---------------- Snippet enrichment: public meta description only (no full-text scraping) ---------------- */
export async function fetchMetaDescription(url: string, timeoutMs = 6_000): Promise<{ description: string | null; title: string | null } | null> {
  if (hostOf(url) === "news.google.com") return null;
  try {
    const res = await fetchWithTimeout(url, { timeoutMs, headers: { Accept: "text/html" }, redirect: "follow" });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return null;
    const html = (await res.text()).slice(0, 300_000);
    const meta = (names: string) =>
      new RegExp(`<meta[^>]+(?:property|name)=["'](?:${names})["'][^>]*content=["']([^"']{20,})["']`, "i").exec(html)?.[1] ??
      new RegExp(`<meta[^>]+content=["']([^"']{20,})["'][^>]*(?:property|name)=["'](?:${names})["']`, "i").exec(html)?.[1] ??
      null;
    const d = meta("og:description|description|twitter:description");
    const t = meta("og:title|twitter:title");
    return { description: d ? cleanText(d).slice(0, 600) : null, title: t ? cleanText(t) : null };
  } catch {
    return null;
  }
}

/* ---------------- Google News link → publisher URL ----------------
 * Google News RSS links are redirect stubs. We resolve them (two small public requests) so that the digest
 * links straight to the publisher, credibility can be judged by real domain, and the public meta description
 * can be used as the snippet. Best effort: on any failure the Google link (which still works) is kept.
 */
export async function resolveGoogleNewsUrl(link: string, timeoutMs = 6_000): Promise<string | null> {
  try {
    const u = new URL(link);
    if (u.hostname !== "news.google.com") return null;
    const id = u.pathname.split("/").pop();
    if (!id) return null;
    const page = await fetchWithTimeout(`https://news.google.com/rss/articles/${id}`, { timeoutMs, headers: { Accept: "text/html" } });
    const html = await page.text();
    const sg = /data-n-a-sg="([^"]+)"/.exec(html)?.[1];
    const ts = /data-n-a-ts="([^"]+)"/.exec(html)?.[1];
    if (!sg || !ts) return null;
    const req = [[["Fbv4je", `["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"${id}",${ts},"${sg}"]`, null, "generic"]]];
    const res = await fetchWithTimeout("https://news.google.com/_/DotsSplashUi/data/batchexecute", {
      timeoutMs,
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: `f.req=${encodeURIComponent(JSON.stringify(req))}`,
    });
    const m = /\[\\"garturlres\\",\\"([^\\"]+)\\"/.exec(await res.text());
    const out = m?.[1];
    return out && /^https?:\/\//.test(out) && !out.includes("news.google.com") ? out : null;
  } catch {
    return null;
  }
}
