# Components Map: CSR Partnership Radar

> AI reads meaning, code checks facts, Ananya makes the call.

![Components map](docs/components_map.svg)

*(The original exam map, [`docs/components_map_original.svg`](docs/components_map_original.svg), labels the database "Supabase". This build uses **Upstash Redis** from the Vercel Marketplace, as the project brief specifies. Its role in the flow is the same.)*

## Swimlanes

| Actor | What it is | Owns |
|---|---|---|
| **Ananya** (Head of Partnerships) | The only human in the loop | Focus settings, the weekly decision, feedback |
| **CSR Radar App** | Next.js 15 (App Router) on Vercel + Vercel Cron | Orchestration, every deterministic check, rendering |
| **Gemini Flash** | `@google/genai`, model from `GEMINI_MODEL` (default `gemini-3.8-flash`) | Classify + extract (step 6), write prose (step 8). Nothing else |
| **Upstash Redis** | Key-value store over REST | Config, digests, seen-URL hashes, feedback, run log, idempotency locks |
| **Live Data APIs** | Google News RSS · GDELT DOC 2.0 · India CSR / The CSR Journal RSS · PIB · NewsAPI (optional) | Last 7 days of public news |
| **Resend** | Email API | Monday email to Ananya's own recipients only |

## The 12 components

| # | Component | Lane | Trigger | Input | Context | Processing | Output | Code |
|---|---|---|---|---|---|---|---|---|
| 1 | **Sets her focus** | Ananya | Any time | Sectors, keywords, geos + tiers, watchlist, weights, recipients | Current config | zod validation; `ADMIN_TOKEN` required to save | Config in Redis | `app/settings/*`, `app/api/settings/route.ts`, `lib/config.ts` |
| 2 | **Cron: Mon 07:00 IST** | App | Vercel Cron `30 1 * * 1`, or the "Run now" button | `Authorization: Bearer CRON_SECRET` / `x-admin-token` | ISO-week lock | Auth check (401 otherwise); set-if-absent lock per ISO week | Starts a run | `vercel.json`, `app/api/run/route.ts`, `lib/auth.ts` |
| 3 | **Loads config + memory** | Redis | Run start | – | Saved settings, seen URLs (30 d), feedback | Fall back to `seed/*.json` if the store is empty or unreachable | `AppConfig` | `lib/config.ts`, `lib/store.ts` |
| 4 | **Pulls last 7 days** | Live APIs | Run | Queries built from config: sector × signal, geo, policy, watchlist (≤ 40) | `lookback_days` | Fetched in parallel with `Promise.allSettled` and a 10 s timeout per source. A dead source is skipped and logged | Raw articles + per-source status | `lib/sources/queries.ts`, `lib/sources/fetchers.ts` |
| 5 | **Clean & filter** | App | Raw articles | Title, snippet, URL, date | IST clock, config keywords | Normalise → valid http(s) URL → IST 7-day window → dedupe (canonical URL, title Jaccard ≥ 0.8, same company + signal) → seen-URL memory → keyword pre-filter + India check → cap 120 → resolve Google News links to the publisher → public meta description as the snippet | ≤ 120 candidates | `lib/pipeline/clean.ts`, `lib/run.ts` |
| 6 | **Classify + extract** | Gemini | Candidates | Batches of 10 as **JSON data** | `prompts/classify.md` with sectors and geos filled in | JSON mode + `responseSchema`, temp 0.2 → zod → one retry with an error hint → rule-based fallback for missing ids | Signal, company, sector, geo mentions, amount, beneficiaries, deadline, exact evidence, confidence, injection flag | `lib/pipeline/classify.ts`, `lib/pipeline/rules.ts`, `lib/gemini.ts` |
| 7 | **Verify & score** | App | Classifications | – | Scoring weights, credibility lists, feedback | Evidence must be a verbatim substring. Partner-search language guard. Geo tiers resolved in code. Deterministic score. Hard caps: confidence < 0.6, unverified evidence, or injection → never CALL | CALL / WATCH / POLICY / SKIP with a score breakdown | `lib/pipeline/score.ts` |
| 8 | **Writes the digest** | Gemini | Selected items | Verified facts only | `prompts/digest.md` | JSON mode, temp 0.3. Writes headline, context, why now and angle, plus week summary and policy notes | Prose | `lib/pipeline/digest.ts` |
| 9 | **Output check** | App | Writer output | Prose + item facts | Source corpus per item | Rejects unknown names, numbers or amounts not in the source, URLs, emails, phones, and headlines that don't name the company. Code re-attaches every fact (verdict, score, URL, date, amount) | Final items, or template text per item | `lib/pipeline/digest.ts` (`checkText`, `templateText`) |
| 10 | **Saves the week** | Redis | Digest built | – | – | Digest by IST date, archive index, seen-URL hashes (30-day TTL), run log | Persisted digest | `lib/run.ts`, `lib/store.ts` |
| 11 | **Monday email** | Resend | Cron run | Digest | Recipients | HTML rendered by code: Call, Watch, Policy Watch, a footer disclaimer, and HMAC-signed feedback links. Quiet week → a short note. Sent at most once per ISO week | Email in Ananya's inbox | `lib/email/render.ts`, `lib/email/send.ts` |
| 12 | **Decides who to call** | Ananya | Reads email / dashboard | 👍 / 👎 / 📞 Called | – | Signed feedback is stored and becomes a bounded per-company score nudge (±5) next week | Her outreach plan. **The system never contacts companies** | `app/api/feedback/route.ts`, `app/components/*` |

## Data flow (arrows on the map)

```
Ananya ──saves settings──▶ Redis ◀──loads config── Cron
Redis ──builds queries──▶ Live APIs ──raw articles──▶ Clean & filter ──candidates──▶ Gemini classify
Gemini classify ──JSON · retry → rule fallback──▶ Verify & score ──▶ Gemini write ──▶ Output check
Output check ──dashboard──▶ Ananya     Output check ──▶ Redis (save) ──sends digest──▶ Resend ──Mon inbox──▶ Ananya
Ananya ──feedback──▶ Redis (next week's ranking)
```

## Out of scope (the cut)
- No auto-outreach to companies (G20).
- No paywalled full-text scraping. Only public headlines, feed snippets and page meta descriptions are used.
- No harvesting of personal contact details (G21).
