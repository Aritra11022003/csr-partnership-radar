import Link from "next/link";

const STEPS: [string, string, string][] = [
  ["1", "Ananya sets her focus", "Sectors, geographies, watchlist and weights in /settings — saved to Redis, validated with zod."],
  ["2", "Cron: Monday 07:00 IST", "Vercel Cron `30 1 * * 1` calls /api/run with CRON_SECRET. A per-ISO-week lock stops double runs; “Run now” uses ADMIN_TOKEN."],
  ["3", "Load config + memory", "Saved settings (fallback: seed files), seen-URL hashes (30 days) and feedback history."],
  ["4", "Pull the last 7 days (live)", "Google News RSS (one query per sector × signal, plus geo, policy and watchlist queries), GDELT DOC 2.0, India CSR + The CSR Journal feeds, PIB, optional NewsAPI — in parallel, 10 s timeout each, a dead source is skipped and logged."],
  ["5", "Clean & filter (code)", "Normalise, IST 7-day window, dedupe (canonical URL, title Jaccard ≥ 0.8, same company + signal), keyword pre-filter, deterministic India check, cap 120. Google News links are resolved to the publisher and the public meta description becomes the snippet."],
  ["6", "Classify + extract (Gemini Flash)", "Batches of 10, JSON mode + responseSchema, temperature 0.2. Article text goes in as JSON data. zod validation → one retry with an error hint → rule-based fallback."],
  ["7", "Verify & score (code)", "Evidence must be a verbatim substring of the source. Deterministic score = signal + sector + geo tier + recency + watchlist + source credibility − unverified penalty ± feedback. Hard rules: confidence < 0.6, unverified evidence, or injection → never CALL."],
  ["8", "Write the digest (Gemini Flash)", "Headline, 2–3 line context, why now, pitch angle. It receives only verified facts and cannot change verdicts, scores, amounts, dates or URLs — code re-attaches those."],
  ["9", "Output check (code)", "Rejects any writer text with unknown names, numbers or amounts not in the source, URLs, emails or phone numbers → falls back to a deterministic template for that item."],
  ["10", "Save the week", "Digest, items, skipped list with reasons, source health, seen URLs and run log in Upstash Redis."],
  ["11", "Monday email", "Resend → Ananya only. Call / Watch / Policy Watch; a quiet week sends a short “no strong signals” note."],
  ["12", "Ananya decides", "👍 / 👎 / 📞 Called links (HMAC-signed) feed a bounded per-company score nudge next week. The system never contacts companies."],
];

const GUARDS: [string, string][] = [
  ["G1 No fabricated facts", "Writer only rephrases given fields; output checker rejects unknown names/numbers → template."],
  ["G2 Evidence required", "Exact-substring check; unverified → −25 and never CALL."],
  ["G3 No guessed numbers", "Amounts/beneficiaries/deadlines null unless stated; writer can’t mention an unstated amount."],
  ["G4 Partner-search precision", "Prompt rule + code guard: no explicit seeking language → NEW_INITIATIVE."],
  ["G5 Every item has a source", "Invalid URLs dropped at ingest and again at output."],
  ["G6 Prompt injection", "Text passed as JSON data; regex pre-scan + model flag → capped at WATCH."],
  ["G7 Secrets safe", "Server-only env vars; logs redacted; /api/health exposes booleans only."],
  ["G8 Protected endpoints", "/api/run needs CRON_SECRET or ADMIN_TOKEN; settings save needs ADMIN_TOKEN."],
  ["G9 Gemini only", "No Anthropic SDK — CI script fails the build if one appears."],
  ["G10–G14 Deterministic correctness", "IST date window, 3-way dedupe, India + sector relevance, zod + retry + fallback, confidence gate."],
  ["G15–G19 Reliability & cost", "allSettled sources, quiet-week email, ≤120 items in batches of 10, maxDuration 300 s, once-per-week lock."],
  ["G20–G23 Human & ethical", "Informs Ananya only, company-level info only, sources + AI disclaimer on every item, DEMO fixtures tagged and isolated."],
];

export default function How() {
  return (
    <>
      <h1>How it works</h1>
      <p className="sub">AI reads meaning, code checks facts, Ananya makes the call. Full write-up in the <a href="https://github.com" target="_blank" rel="noreferrer">README</a> and <span className="code">COMPONENTS_MAP.md</span>.</p>
      <h2>Components map</h2>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="mapimg" src="/components_map.svg" alt="Components map: Ananya → settings → cron → config → live data → clean → Gemini classify → verify & score → Gemini write → output check → store → email → feedback" />
      <h2>Pipeline</h2>
      <div className="panel scroll">
        <table>
          <thead><tr><th style={{ width: 30 }}>#</th><th style={{ width: 220 }}>Step</th><th>What happens</th></tr></thead>
          <tbody>
            {STEPS.map(([n, t, d]) => (
              <tr key={n}><td><b>{n}</b></td><td><b>{t}</b></td><td className="muted">{d}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2>Guardrails (each one tested)</h2>
      <div className="panel scroll">
        <table>
          <tbody>
            {GUARDS.map(([g, d]) => (
              <tr key={g}><td style={{ width: 240 }}><b>{g}</b></td><td className="muted">{d}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2>Out of scope (the cut)</h2>
      <p className="muted">No auto-outreach to companies. No paywalled full-text scraping (only public headlines, feed snippets and meta descriptions). No personal contact harvesting.</p>
      <p><Link href="/">← Back to the latest digest</Link></p>
    </>
  );
}
