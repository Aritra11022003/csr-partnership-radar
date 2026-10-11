"use client";
import { useMemo, useState } from "react";
import type { Digest, DigestItem } from "@/lib/types";
import { EmailDigestButton, FeedbackButtons, RunNowButton } from "./ClientBits";
import { RadarChart } from "./RadarChart";
import { IconClock, IconPin, IconQuote, IconRupee, IconUsers, SIGNAL_ICON } from "./Icons";

type Sigs = Record<string, Record<"up" | "down" | "called", string>>;
type Policy = DigestItem & { note: string };

const SIGNAL: Record<string, { label: string; color: string }> = {
  PARTNER_SEARCH: { label: "Partner search", color: "#138a52" },
  NEW_INITIATIVE: { label: "New initiative", color: "#3b4fd6" },
  ALLOCATION_UP: { label: "Budget up", color: "#c27c00" },
  POLICY: { label: "Policy", color: "#6a5ae0" },
  IRRELEVANT: { label: "Other", color: "#778196" },
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Deterministic IST date (no locale differences between server and browser). */
function fmt(iso: string) {
  const d = new Date(new Date(iso).getTime() + 5.5 * 3600e3);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
function daysAgo(iso: string, now: string) {
  const n = Math.round((Date.parse(now) - Date.parse(iso)) / 864e5);
  return n <= 0 ? "today" : n === 1 ? "1 day ago" : `${n} days ago`;
}
function nextMonday(from: string) {
  const d = new Date(new Date(from).getTime() + 5.5 * 3600e3);
  const add = ((8 - d.getUTCDay()) % 7) || 7;
  d.setUTCDate(d.getUTCDate() + add);
  return `Mon ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, 07:00 IST`;
}
const PALETTE = ["#3b4fd6", "#138a52", "#c2410c", "#7c3aed", "#0e7490", "#be185d", "#a16207", "#4d7c0f"];
function monogram(name: string | null, fallback: string) {
  const n = (name ?? fallback).replace(/\b(ltd|limited|the|pvt|india)\b\.?/gi, "").trim();
  const parts = n.split(/[\s&.-]+/).filter(Boolean);
  const init = ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
  let h = 0;
  for (const c of n) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return { init, color: PALETTE[h % PALETTE.length] };
}
const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

function Ring({ score, verdict }: { score: number; verdict: string }) {
  const pct = Math.max(0, Math.min(100, score));
  const r = 23;
  const c = 2 * Math.PI * r;
  const color = verdict === "CALL" ? "var(--call)" : verdict === "WATCH" ? "var(--watch)" : "var(--policy)";
  return (
    <div className="ring" title={`Deterministic score ${score}/100 (CALL ≥ 65, WATCH ≥ 40)`}>
      <svg width="56" height="56" viewBox="0 0 56 56" role="img" aria-label={`score ${score}`}>
        <circle cx="28" cy="28" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="5" />
        <circle cx="28" cy="28" r={r} fill="none" stroke={color} strokeWidth="5" strokeLinecap="round" strokeDasharray={`${(pct / 100) * c} ${c}`} transform="rotate(-90 28 28)" />
        <text x="28" y="33" textAnchor="middle" fontSize="15" fontWeight="700" fill="var(--ink)">{score}</text>
      </svg>
      <div className="lbl">score</div>
    </div>
  );
}

function Flags({ i }: { i: DigestItem }) {
  return (
    <>
      {i.demo && <span className="chip warn">DEMO</span>}
      {!i.verified && <span className="chip warn" title="Evidence quote not found verbatim in the source text">unverified</span>}
      {i.injection_flag && <span className="chip warn" title="Source text contained instructions aimed at the AI; capped at WATCH">suspicious text</span>}
      {i.confidence < 0.6 && <span className="chip" title="Model confidence below 0.6 — cannot be CALL">low confidence</span>}
    </>
  );
}

function Source({ i, now }: { i: DigestItem; now: string }) {
  const h = host(i.url);
  return (
    <div className="meta">
      <a href={i.url} target="_blank" rel="noopener noreferrer">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`https://www.google.com/s2/favicons?domain=${h}&sz=32`} alt="" loading="lazy" />
        {i.source} ↗
      </a>
      <span>{fmt(i.publishedAt)} · {daysAgo(i.publishedAt, now)}</span>
      {i.alsoReportedBy.length > 0 && <span>+{i.alsoReportedBy.length} more source{i.alsoReportedBy.length > 1 ? "s" : ""}</span>}
    </div>
  );
}

function ItemCard({ d, i, sigs, compact }: { d: Digest; i: DigestItem | Policy; sigs: Sigs; compact?: boolean }) {
  const m = monogram(i.company, i.source);
  const isPolicy = i.signal === "POLICY";
  const verdict = isPolicy ? "POLICY" : i.verdict;
  return (
    <article id={`item-${i.id}`} className={`card v-${verdict.toLowerCase()} ${compact ? "compact" : ""}`}>
      <div className="mono" style={{ background: isPolicy ? "#6a5ae0" : m.color }} aria-hidden>{isPolicy ? "§" : m.init}</div>
      <div style={{ minWidth: 0 }}>
        <div className="row" style={{ gap: 6 }}>
          <span className={`chip ${verdict === "CALL" ? "call" : verdict === "WATCH" ? "watch" : "policy"}`}>{verdict === "CALL" ? "CALL THIS WEEK" : verdict}</span>
          <span className="chip sig" style={{ color: SIGNAL[i.signal].color }}>
            {SIGNAL_ICON[i.signal] ? SIGNAL_ICON[i.signal]({ size: 13 }) : null}
            {SIGNAL[i.signal].label}
          </span>
          <Flags i={i} />
        </div>
        <div className="headline">{i.headline}</div>
        <div className="tags">
          {i.company && <span className="tag"><b>{i.company}</b></span>}
          {i.sector && <span className="tag">{i.sector}</span>}
          {i.geo && <span className="tag"><IconPin />{i.geo}</span>}
          {i.amount_inr_crore != null && <span className="tag money"><IconRupee />{i.amount_inr_crore} crore</span>}
          {i.beneficiaries && <span className="tag"><IconUsers />{i.beneficiaries}</span>}
          {i.deadline && <span className="tag due"><IconClock />{i.deadline}</span>}
        </div>
        {isPolicy ? (
          <p className="ctx">{(i as Policy).note}</p>
        ) : (
          <>
            <p className="ctx">{i.context}</p>
            <div className="why">
              <div className="now"><b>Why now</b>{i.why_now}</div>
              {!compact && <div><b>Angle</b>{i.suggested_angle}</div>}
            </div>
          </>
        )}
        <blockquote className="ev"><span className="q"><IconQuote /></span>{i.evidence}</blockquote>
        <Source i={i} now={d.generatedAt} />
        {!isPolicy && sigs[i.id] && <FeedbackButtons d={d.id} i={i.id} sigs={sigs[i.id]} />}
      </div>
      {!isPolicy && <Ring score={i.score} verdict={verdict} />}
    </article>
  );
}

function Bars({ title, data }: { title: string; data: [string, number][] }) {
  const max = Math.max(1, ...data.map((x) => x[1]));
  if (!data.length) return null;
  return (
    <div className="panel">
      <h3>{title}</h3>
      <div className="bars">
        {data.map(([k, v]) => (
          <div className="bar" key={k}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{k}</span>
            <div className="track"><div className="fill" style={{ width: `${(v / max) * 100}%` }} /></div>
            <span className="v">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const count = (items: DigestItem[], f: (i: DigestItem) => string | null) => {
  const m = new Map<string, number>();
  for (const i of items) {
    const k = f(i);
    if (k) m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
};

export function DigestBoard({ d, sigs, showRun, sampleId }: { d: Digest; sigs: Sigs; showRun: boolean; sampleId?: string | null }) {
  const [signal, setSignal] = useState("ALL");
  const [sector, setSector] = useState("ALL");
  const [q, setQ] = useState("");
  const all = useMemo(() => [...d.call, ...d.watch, ...d.policy] as DigestItem[], [d]);
  const sectors = [...new Set(all.map((i) => i.sector).filter(Boolean))] as string[];
  const match = (i: DigestItem) =>
    (signal === "ALL" || i.signal === signal) &&
    (sector === "ALL" || i.sector === sector) &&
    (!q || `${i.headline} ${i.company} ${i.context} ${i.geo} ${i.source}`.toLowerCase().includes(q.toLowerCase()));
  const call = d.call.filter(match);
  const watch = d.watch.filter(match);
  const policy = d.policy.filter(match);
  const s = d.stats;
  const okSources = d.sourceStatus.filter((x) => x.ok).length;
  const funnel: [string, number][] = [
    ["Fetched", s.fetched],
    ["In 7-day window", s.afterDate],
    ["After dedupe", s.afterDedupe],
    ["Pre-filtered", s.afterPrefilter],
    ["In digest", all.length],
  ];

  return (
    <>
      <section className="hero">
        <div className="wrap hero-grid">
          <div className="hero-main">
          <div className="hero-top">
            <div>
              <div className="eyebrow">Weekly CSR digest · {d.week}</div>
              <h1 className="display">Week of {fmt(d.generatedAt)}</h1>
              <div className="sub">Covering {fmt(d.windowStart)} – {fmt(d.windowEnd)}</div>
              <div className="pills">
                <span className="pill"><span className={`dot ${okSources < d.sourceStatus.length ? "warn" : ""}`} />{okSources}/{d.sourceStatus.length} live sources OK</span>
                <span className="pill">✦ {d.writer === "gemini" ? `Written by ${d.model}` : "Template writer"}</span>
                <span className="pill">⏱ Next run {nextMonday(d.generatedAt)}</span>
                <span className="pill"><a href={`/api/email-preview?id=${d.id}`} target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }}>👁 Preview email ↗</a></span>
                <EmailDigestButton digestId={d.id} />
              </div>
            </div>
            {showRun && <RunNowButton hero />}
          </div>
          {d.demo && <div className="banner demo">{d.id.endsWith("-sample") ? "SAMPLE DIGEST: built only from synthetic test fixtures (fictional companies) to show every path, including CALL. Not real news. The real weekly digest is on the home page." : "DEMO MODE: synthetic fixtures with fictional companies, tagged DEMO, are mixed in. Never used in production."}</div>}
          <p className="summary-hero">{d.week_summary}</p>
          <div className="tiles">
            <div className="tile call"><div className="n">{d.call.length}</div><div className="l">Call this week</div></div>
            <div className="tile watch"><div className="n">{d.watch.length}</div><div className="l">Watch</div></div>
            <div className="tile policy"><div className="n">{d.policy.length}</div><div className="l">Policy updates</div></div>
            <div className="tile"><div className="n">{s.fetched}</div><div className="l">Articles scanned</div></div>
          </div>
          </div>
          {all.length > 0 && (
            <div className="hero-radar">
              <RadarChart items={all} />
            </div>
          )}
        </div>
      </section>

      <div className="wrap" style={{ paddingTop: 0 }}>
        {all.length > 0 && (
          <div className="toolbar" style={{ marginTop: 18 }}>
            <div className="seg" role="tablist" aria-label="Signal">
              {["ALL", "PARTNER_SEARCH", "NEW_INITIATIVE", "ALLOCATION_UP", "POLICY"].map((k) => (
                <button key={k} className={signal === k ? "on" : ""} onClick={() => setSignal(k)}>
                  {k === "ALL" ? `All (${all.length})` : `${SIGNAL[k].label} (${all.filter((i) => i.signal === k).length})`}
                </button>
              ))}
            </div>
            <select value={sector} onChange={(e) => setSector(e.target.value)} aria-label="Sector">
              <option value="ALL">All sectors</option>
              {sectors.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
            <input type="search" placeholder="Search company, place, source…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        )}

        <div className="grid-main">
          <div>
            {d.quiet ? (
              <div className="empty" style={{ marginTop: 38 }}>
                <h2 style={{ justifyContent: "center", marginTop: 0 }}>Quiet week</h2>
                <p>No strong signals: {s.fetched} articles from {s.sources} sources, and nothing in your sectors cleared the WATCH bar.</p>
              </div>
            ) : (
              <>
                <h2><span className="sh call" />Call this week <span className="count">{call.length}</span></h2>
                {call.length ? call.map((i) => <ItemCard key={i.id} d={d} i={i} sigs={sigs} />) : (
                  <div className="panel muted">
                    Nothing reached CALL this week{signal !== "ALL" || sector !== "ALL" || q ? " for this filter" : ""}. A CALL needs a strong, verified signal in a focus sector, ideally in Pune or Maharashtra. Check the watch list below.
                    {sampleId && (
                      <> {" "}<a href={`/digest/${sampleId}`}>See what a CALL looks like in the sample digest (DEMO data) →</a></>
                    )}
                  </div>
                )}
                {watch.length > 0 && (
                  <>
                    <h2><span className="sh watch" />Watch <span className="count">{watch.length}</span></h2>
                    {watch.map((i) => <ItemCard key={i.id} d={d} i={i} sigs={sigs} compact />)}
                  </>
                )}
                {policy.length > 0 && (
                  <>
                    <h2><span className="sh policy" />Policy watch <span className="count">{policy.length}</span></h2>
                    {policy.map((i) => <ItemCard key={i.id} d={d} i={i} sigs={sigs} compact />)}
                  </>
                )}
              </>
            )}

            <details id="skipped">
              <summary>Skipped {d.skipped.length} items, and why</summary>
              <div className="scroll">
                <table>
                  <thead><tr><th>Item</th><th>Reason</th></tr></thead>
                  <tbody>
                    {d.skipped.slice(0, 250).map((x, n) => (
                      <tr key={n}>
                        <td>{x.url ? <a href={x.url} target="_blank" rel="noopener noreferrer">{x.title}</a> : x.title} <span className="muted">· {x.source}</span></td>
                        <td className="muted">{x.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
            {d.warnings.length > 0 && (
              <details>
                <summary>Run notes ({d.warnings.length})</summary>
                <ul className="sub">{d.warnings.map((w, n) => <li key={n}>{w}</li>)}</ul>
              </details>
            )}
          </div>

          <aside className="side">
            <div className="panel">
              <h3>Pipeline this week</h3>
              <div className="funnel">
                {funnel.map(([k, v]) => (
                  <div className="step" key={k}>
                    <span>{k}</span><b>{v}</b>
                    <div className="track"><div className="fill" style={{ width: `${Math.max(3, (v / Math.max(1, s.fetched)) * 100)}%` }} /></div>
                  </div>
                ))}
              </div>
              <p className="sub" style={{ marginTop: 10 }}>
                {s.classifiedByLlm} classified by Gemini{s.classifiedByRules ? `, ${s.classifiedByRules} by rules` : ""} · {s.injectionFlags} injection flag(s) · {s.unverified} unverified
              </p>
            </div>
            <Bars title="Signals by sector" data={count(all, (i) => i.sector)} />
            <Bars title="Where" data={count(all, (i) => i.geo)} />
            <div className="panel">
              <h3>Live sources</h3>
              <div className="srcs">
                {d.sourceStatus.map((x) => (
                  <div key={x.name} title={x.error ?? ""}>
                    <span>{x.name}</span>
                    <span className={x.ok ? "ok" : "bad"}>{x.ok ? `${x.count}` : "skipped"}</span>
                  </div>
                ))}
              </div>
              <p className="sub" style={{ marginTop: 8 }}>A failing source never stops the run.</p>
            </div>
          </aside>
        </div>
      </div>
    </>
  );
}
