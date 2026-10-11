/**
 * The whole weekly pipeline, end to end (see COMPONENTS_MAP.md):
 * load config → fetch (parallel) → normalise → 7-day filter → dedupe → seen-URL memory → pre-filter
 * → enrich snippets → Gemini classify (batched) → verify + score → write digest → output check → store → email.
 */
import type { AppConfig, Digest, DigestItem, RawArticle, ScoredItem, SkippedItem, SourceStatus } from "./types";
import { loadConfig } from "./config";
import { getStore, KEYS } from "./store";
import { fetchAllLive, fetchMetaDescription, resolveGoogleNewsUrl, type FetchResult } from "./sources/fetchers";
import { fixtureStatus, isDemoMode, loadFixtures } from "./sources/demo";
import { dedupe, filterByDate, normalize, prefilter, sameCompanySignalKey } from "./pipeline/clean";
import { detectInjection } from "./pipeline/injection";
import { classifyAll, type LlmFn } from "./pipeline/classify";
import { companyKey, scoreItem } from "./pipeline/score";
import { writeDigest, type DigestLlmFn } from "./pipeline/digest";
import { activeModel, geminiConfigured } from "./gemini";
import { canonicalUrl, hostOf, isoWeekKey, istDate, isHttpUrl, sha1 } from "./util";
import { sendDigestEmail } from "./email/send";
import type { Feedback } from "./types";

export interface RunOptions {
  now?: Date;
  trigger: "cron" | "manual" | "script" | "test";
  /** Send the email (respecting once-per-week idempotency unless forceEmail). */
  sendEmail?: boolean;
  forceEmail?: boolean;
  demo?: boolean;
  /** Skip live fetching (tests). */
  offline?: boolean;
  config?: AppConfig;
  classifyLlm?: LlmFn | null;
  digestLlm?: DigestLlmFn | null;
  enrich?: boolean;
  persist?: boolean;
  log?: (msg: string) => void;
}

const SEEN_TTL = 30 * 24 * 3600; // G11: seen URLs kept 30 days

export async function runPipeline(opts: RunOptions): Promise<{ digest: Digest; scored: ScoredItem[]; perQuery: FetchResult["perQuery"] }> {
  const t0 = Date.now();
  const log = opts.log ?? ((m: string) => console.log(`[run] ${m}`));
  const now = opts.now ?? new Date();
  const store = getStore();
  const persist = opts.persist ?? true;
  const demo = opts.demo ?? isDemoMode();
  const weekId = isoWeekKey(now);
  const warnings: string[] = [];

  // 3. config + memory
  const { config, source: cfgSource } = opts.config ? { config: opts.config, source: "seed" as const } : await loadConfig();
  log(`config from ${cfgSource}; sectors=${config.sectors.filter((s) => s.enabled).map((s) => s.id).join(",")}`);

  // 4. fetch
  const results: FetchResult[] = opts.offline ? [] : await fetchAllLive(config);
  const raw: RawArticle[] = results.flatMap((r) => r.articles);
  const sourceStatus: SourceStatus[] = results.map((r) => r.status);
  if (demo) {
    const fx = loadFixtures(now);
    raw.push(...fx);
    sourceStatus.push(fixtureStatus(fx.length));
    warnings.push("DEMO_MODE is on: synthetic fixtures (fictional companies) are mixed in and tagged DEMO.");
  }
  for (const s of sourceStatus) log(`source ${s.name}: ${s.ok ? "ok" : "FAILED"} ${s.count} items in ${s.ms}ms${s.error ? ` (${s.error})` : ""}`);
  const perQuery = results.find((r) => r.perQuery && r.status.name === "Google News RSS")?.perQuery;

  // 5. clean & filter
  const skipped: SkippedItem[] = [];
  const norm = normalize(raw);
  skipped.push(...norm.dropped);
  const dated = filterByDate(norm.articles, config.lookback_days, now);
  skipped.push(...dated.dropped);
  const deduped = dedupe(dated.kept, config);
  log(`normalised ${norm.articles.length}, in window ${dated.kept.length}, after dedupe ${deduped.kept.length}`);

  // Seen-URL memory: drop items already surfaced in a *previous* week's digest.
  let fresh = deduped.kept;
  if (persist) {
    try {
      const seen = await store.mget<{ week: string }>(fresh.map((a) => KEYS.seen(sha1(a.canonicalUrl))));
      const before = fresh.length;
      fresh = fresh.filter((a, i) => {
        const s = seen[i];
        if (s && s.week !== weekId) {
          skipped.push({ title: a.title, url: a.url, source: a.source, reason: `already surfaced in ${s.week}` });
          return false;
        }
        return true;
      });
      if (before !== fresh.length) log(`seen-URL memory removed ${before - fresh.length}`);
    } catch (e) {
      warnings.push(`seen-URL memory unavailable: ${(e as Error).message}`);
    }
  }

  const pre = prefilter(fresh, config);
  skipped.push(...pre.dropped);
  let candidates = pre.kept;
  log(`pre-filter kept ${candidates.length} (cap ${config.limits.max_items_to_llm})`);

  if (opts.enrich ?? !opts.offline) {
    // Resolve Google News redirect links to the publisher URL (best effort, bounded concurrency).
    const gn = candidates.filter((a) => hostOf(a.url) === "news.google.com");
    let gi = 0;
    let resolved = 0;
    await Promise.all(
      Array.from({ length: 8 }, async () => {
        while (gi < gn.length) {
          const a = gn[gi++];
          const real = await resolveGoogleNewsUrl(a.url);
          if (real && isHttpUrl(real)) {
            a.url = real;
            a.canonicalUrl = canonicalUrl(real);
            if (!a.source || !a.source.includes(".")) a.source = hostOf(real);
            resolved++;
          }
        }
      }),
    );
    if (gn.length) log(`resolved ${resolved}/${gn.length} Google News links to publisher URLs`);
    // Same story found via different routes now shares a canonical URL → merge again.
    candidates = dedupe(candidates, config).kept;

    // Enrich: public meta description for items lacking a snippet (no paywalled full-text scraping).
    const toEnrich = candidates.filter((a) => (!a.snippet || /(…|\.\.\.)$/.test(a.title)) && !a.demo && hostOf(a.url) !== "news.google.com").slice(0, 60);
    let i = 0;
    await Promise.all(
      Array.from({ length: 8 }, async () => {
        while (i < toEnrich.length) {
          const a = toEnrich[i++];
          const m = await fetchMetaDescription(a.url);
          if (m?.description && m.description.toLowerCase() !== a.title.toLowerCase()) a.snippet = m.description;
          // Feed titles are often truncated ("…"); take the publisher's full title when it clearly is the same headline.
          const stem = a.title.replace(/(…|\.\.\.)$/, "").trim();
          if (m?.title && stem !== a.title && m.title.toLowerCase().startsWith(stem.toLowerCase().slice(0, 30))) a.title = m.title;
        }
      }),
    );
    log(`enriched ${toEnrich.filter((a) => a.snippet).length}/${toEnrich.length} snippets from public meta descriptions`);
    // Re-scan for injection now that snippets have more text.
    for (const a of candidates) a.injectionSuspected = a.injectionSuspected || detectInjection(`${a.title} ${a.snippet}`);
  }

  // 6. classify
  const llm = opts.classifyLlm === undefined ? undefined : opts.classifyLlm;
  const { classifications, stats } = await classifyAll(candidates, config, llm);
  if (!geminiConfigured() && llm === undefined) warnings.push("GEMINI_API_KEY not set: rule-based classifier used (conservative, never CALL).");
  if (stats.errors.length) warnings.push(...stats.errors.slice(0, 5).map((e) => `classifier: ${e}`));
  log(`classified: ${stats.byLlm} by Gemini, ${stats.byRules} by rules, ${stats.retries} retries`);

  // Feedback loop: bounded score nudge per company from Ananya's 👍/👎/Called.
  const feedbackAdjust: Record<string, number> = {};
  if (persist) {
    try {
      const fb = await store.lrange<Feedback>(KEYS.feedback, 0, 499);
      for (const f of fb) {
        const k = companyKey(f.company);
        if (!k) continue;
        feedbackAdjust[k] = (feedbackAdjust[k] ?? 0) + (f.kind === "down" ? -2 : f.kind === "called" ? 2 : 1);
      }
    } catch {
      /* feedback is optional */
    }
  }

  // 7. verify + score
  const byId = new Map(candidates.map((a) => [a.id, a]));
  let scored = classifications.map((c) => scoreItem(byId.get(c.id)!, c, config, { now, feedbackAdjust }));

  // G11 (third rule): same company + same signal within the week → keep the best, list the others as sources.
  const bestByKey = new Map<string, ScoredItem>();
  const merged = new Set<string>();
  for (const s of [...scored].sort((a, b) => b.score - a.score)) {
    if (s.section === "SKIP") continue;
    const k = sameCompanySignalKey(s.cls.company, s.cls.signal);
    if (!k) continue;
    const best = bestByKey.get(k);
    if (!best) bestByKey.set(k, s);
    else {
      best.article.alsoReportedBy.push({ source: s.article.source, url: s.article.url }, ...s.article.alsoReportedBy);
      merged.add(s.id);
    }
  }
  scored = scored.filter((s) => !merged.has(s.id));

  // G5 again at the output boundary; G23 fixtures never in a non-demo digest.
  scored = scored.filter((s) => isHttpUrl(s.article.url) && (demo || !s.article.demo));

  const ranked = [...scored].sort((a, b) => b.score - a.score);
  const callItems = ranked.filter((s) => s.section === "CALL");
  const watchItems = ranked.filter((s) => s.section === "WATCH");
  const policyItems = ranked.filter((s) => s.section === "POLICY").slice(0, 5);
  const maxItems = config.limits.max_digest_items;
  const selCall = callItems.slice(0, maxItems);
  const selWatch = watchItems.slice(0, Math.max(0, maxItems - selCall.length));
  const selected = [...selCall, ...selWatch, ...policyItems];
  for (const s of ranked)
    if (!selected.includes(s))
      skipped.push({
        title: s.article.title,
        url: s.article.url,
        source: s.article.source,
        reason: s.section === "SKIP" ? s.verdictReasons[0] ?? `score ${s.score} below WATCH threshold` : "over max_digest_items",
      });

  // 8–9. write + check
  const written = await writeDigest(selected, config, opts.digestLlm === undefined ? undefined : opts.digestLlm);
  warnings.push(...written.warnings);

  const toItem = (s: ScoredItem): DigestItem => ({
    ...written.texts.get(s.id)!,
    company: s.cls.company,
    signal: s.cls.signal,
    sector: s.sectorLabel,
    geo: s.geo?.label ?? null,
    score: s.score,
    verdict: s.verdict,
    evidence: s.cls.evidence ?? "",
    verified: s.verified,
    url: s.article.url,
    source: s.article.source,
    publishedAt: s.article.publishedAt,
    amount_inr_crore: s.cls.amount_inr_crore,
    beneficiaries: s.cls.beneficiaries,
    deadline: s.cls.deadline,
    alsoReportedBy: s.article.alsoReportedBy,
    injection_flag: s.cls.injection_flag,
    demo: s.article.demo,
    confidence: s.cls.confidence,
  });

  const okSources = sourceStatus.filter((s) => s.ok && s.count > 0).length;
  const digest: Digest = {
    id: istDate(now),
    week: weekId,
    date: istDate(now),
    generatedAt: now.toISOString(),
    windowStart: new Date(now.getTime() - config.lookback_days * 864e5).toISOString(),
    windowEnd: now.toISOString(),
    week_summary: written.week_summary,
    call: selCall.map(toItem),
    watch: selWatch.map(toItem),
    policy: policyItems.map((s) => ({ ...toItem(s), note: written.policyNotes.get(s.id) ?? "" })),
    skipped: skipped.slice(0, 400),
    stats: {
      fetched: raw.length,
      afterDate: dated.kept.length,
      afterDedupe: deduped.kept.length,
      afterPrefilter: candidates.length,
      sentToLlm: llm === null || (!geminiConfigured() && llm === undefined) ? 0 : candidates.length,
      classifiedByLlm: stats.byLlm,
      classifiedByRules: stats.byRules,
      sources: okSources,
      injectionFlags: scored.filter((s) => s.cls.injection_flag).length,
      unverified: scored.filter((s) => !s.verified && s.cls.signal !== "IRRELEVANT").length,
    },
    sourceStatus,
    writer: written.writer,
    model: geminiConfigured() || llm ? activeModel() : null,
    demo,
    quiet: selCall.length === 0 && selWatch.length === 0 && policyItems.length === 0,
    warnings,
  };
  if (digest.quiet) log("quiet week: no strong signals");

  // 10. store
  if (persist) {
    try {
      await store.set(KEYS.digest(digest.id), digest);
      await store.set(KEYS.latest, digest.id);
      const index = (await store.get<string[]>(KEYS.digestIndex)) ?? [];
      if (!index.includes(digest.id)) await store.set(KEYS.digestIndex, [digest.id, ...index].slice(0, 104));
      const surfaced = [...digest.call, ...digest.watch, ...digest.policy];
      await store.msetWithTtl(
        surfaced.map((i) => [KEYS.seen(sha1(candidates.find((c) => c.url === i.url)?.canonicalUrl ?? i.url)), { week: weekId }]),
        SEEN_TTL,
      );
      await store.lpush(KEYS.runLog, { at: now.toISOString(), trigger: opts.trigger, week: weekId, ms: Date.now() - t0, call: digest.call.length, watch: digest.watch.length, policy: digest.policy.length, fetched: raw.length }, 100);
    } catch (e) {
      warnings.push(`could not persist digest: ${(e as Error).message}`);
    }
  }

  // 11. email — at most once per ISO week unless forced (G19).
  if (opts.sendEmail) {
    const first = persist ? await store.setNX(KEYS.emailed(weekId), { at: new Date().toISOString() }, 14 * 24 * 3600) : true;
    if (first || opts.forceEmail) {
      digest.emailed = await sendDigestEmail(digest, config);
      if (digest.emailed.error && persist) await store.del(KEYS.emailed(weekId));
      if (persist) await store.set(KEYS.digest(digest.id), digest);
      log(digest.emailed.error ? `email failed: ${digest.emailed.error}` : `email sent to ${digest.emailed.to.join(", ")}`);
    } else {
      log(`email for ${weekId} already sent — skipping (idempotent)`);
      warnings.push(`Email for ${weekId} was already sent; not re-sent.`);
    }
  }

  log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s — CALL ${digest.call.length}, WATCH ${digest.watch.length}, POLICY ${digest.policy.length}, skipped ${digest.skipped.length}`);
  return { digest, scored, perQuery };
}

export async function getLatestDigest(): Promise<Digest | null> {
  const store = getStore();
  const id = await store.get<string>(KEYS.latest);
  return id ? store.get<Digest>(KEYS.digest(id)) : null;
}

export async function getDigest(id: string): Promise<Digest | null> {
  return getStore().get<Digest>(KEYS.digest(id));
}

export async function listDigests(): Promise<string[]> {
  return (await getStore().get<string[]>(KEYS.digestIndex)) ?? [];
}
