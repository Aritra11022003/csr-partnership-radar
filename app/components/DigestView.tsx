import type { Digest, DigestItem } from "@/lib/types";
import { SIGNAL_LABEL } from "@/lib/pipeline/digest";
import { feedbackSig, fmtDate } from "@/lib/email/render";
import { FeedbackButtons } from "./ClientBits";

const sigs = (d: string, i: string) => ({ up: feedbackSig(d, i, "up"), down: feedbackSig(d, i, "down"), called: feedbackSig(d, i, "called") });

function Flags({ i }: { i: DigestItem }) {
  return (
    <>
      {i.demo && <span className="chip warn">DEMO</span>}
      {!i.verified && <span className="chip warn" title="Evidence quote was not found verbatim in the source text">evidence unverified</span>}
      {i.injection_flag && <span className="chip warn" title="Source text contained instructions aimed at the AI; capped at WATCH">suspicious text</span>}
      {i.confidence < 0.6 && <span className="chip" title="Model confidence below 0.6 — cannot be CALL">low confidence</span>}
    </>
  );
}

function Tags({ i }: { i: DigestItem }) {
  return (
    <div className="tags">
      {i.company && <span><b style={{ color: "var(--ink-2)" }}>{i.company}</b></span>}
      {i.sector && <span>{i.sector}</span>}
      {i.geo && <span>{i.geo}</span>}
      <span>{SIGNAL_LABEL[i.signal]}</span>
      {i.amount_inr_crore != null && <span>₹{i.amount_inr_crore} crore</span>}
      {i.deadline && <span>deadline: {i.deadline}</span>}
    </div>
  );
}

function Source({ i }: { i: DigestItem }) {
  return (
    <div className="meta">
      <a href={i.url} target="_blank" rel="noopener noreferrer">{i.source} ↗</a>
      <span>{fmtDate(i.publishedAt)}</span>
      {i.alsoReportedBy.length > 0 && (
        <span>
          also:{" "}
          {i.alsoReportedBy.slice(0, 3).map((x, n) => (
            <a key={n} href={x.url} target="_blank" rel="noopener noreferrer" style={{ marginRight: 6 }}>{x.source}</a>
          ))}
        </span>
      )}
    </div>
  );
}

function CallCard({ d, i }: { d: Digest; i: DigestItem }) {
  return (
    <article className="card call">
      <div className="row" style={{ gap: 6 }}>
        <span className="chip call">CALL</span>
        <span className="chip">score {i.score}</span>
        <Flags i={i} />
      </div>
      <div className="headline">{i.headline}</div>
      <Tags i={i} />
      <p className="ctx">{i.context}</p>
      <p className="kv"><b>Why now:</b> {i.why_now}</p>
      <p className="kv"><b>Angle:</b> {i.suggested_angle}</p>
      <blockquote className="ev">“{i.evidence}”</blockquote>
      <Source i={i} />
      <FeedbackButtons d={d.id} i={i.id} sigs={sigs(d.id, i.id)} />
    </article>
  );
}

function WatchCard({ d, i }: { d: Digest; i: DigestItem }) {
  return (
    <article className="card watch">
      <div className="row spread" style={{ alignItems: "flex-start" }}>
        <div className="headline">{i.headline}</div>
        <div className="row" style={{ gap: 6 }}>
          <span className="chip watch">WATCH · {i.score}</span>
          <Flags i={i} />
        </div>
      </div>
      <Tags i={i} />
      <p className="ctx" style={{ fontSize: 14 }}>{i.context} <b>Why now:</b> {i.why_now}</p>
      <blockquote className="ev">“{i.evidence}”</blockquote>
      <Source i={i} />
      <FeedbackButtons d={d.id} i={i.id} sigs={sigs(d.id, i.id)} />
    </article>
  );
}

function PolicyCard({ i }: { i: DigestItem & { note: string } }) {
  return (
    <article className="card policy">
      <div className="row spread" style={{ alignItems: "flex-start" }}>
        <div className="headline">{i.headline}</div>
        <div className="row" style={{ gap: 6 }}><span className="chip policy">POLICY</span><Flags i={i} /></div>
      </div>
      <p className="ctx" style={{ fontSize: 14 }}>{i.note}</p>
      <blockquote className="ev">“{i.evidence}”</blockquote>
      <Source i={i} />
    </article>
  );
}

export function DigestView({ d }: { d: Digest }) {
  const s = d.stats;
  return (
    <div>
      <div className="row spread" style={{ alignItems: "flex-end" }}>
        <div>
          <div className="eyebrow">CSR Partnership Radar · {d.week}</div>
          <h1>Week of {fmtDate(d.generatedAt)}</h1>
          <div className="sub">
            Covering {fmtDate(d.windowStart)} – {fmtDate(d.windowEnd)} · generated {new Date(d.generatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST ·
            writer: {d.writer === "gemini" ? `Gemini (${d.model})` : "template"}
            {d.emailed && (d.emailed.error ? ` · email: ${d.emailed.error}` : ` · emailed to ${d.emailed.to.length} recipient(s)`)}
            {" · "}
            <a href={`/api/email-preview?id=${d.id}`} target="_blank" rel="noopener noreferrer">view as email ↗</a>
          </div>
        </div>
      </div>

      {d.demo && <div className="banner demo">DEMO MODE — synthetic fixtures (fictional companies, tagged DEMO) are mixed into this digest. Never used in production.</div>}

      <div className="tiles">
        <div className="tile call"><div className="n">{d.call.length}</div><div className="l">🟢 Call this week</div></div>
        <div className="tile watch"><div className="n">{d.watch.length}</div><div className="l">🟡 Watch</div></div>
        <div className="tile policy"><div className="n">{d.policy.length}</div><div className="l">🏛 Policy</div></div>
        <div className="tile"><div className="n">{s.fetched}</div><div className="l">Articles scanned · {s.sources} sources</div></div>
      </div>

      <div className="summary">{d.week_summary}</div>

      {d.quiet && (
        <div className="empty" style={{ marginTop: 18 }}>
          <b>No strong signals this week.</b>
          <div className="sub">Scanned {s.fetched} articles from {s.sources} sources — nothing in your sectors cleared the WATCH bar.</div>
        </div>
      )}

      {!d.quiet && (
        <>
          <h2>🟢 Call this week <span className="chip call">{d.call.length}</span></h2>
          {d.call.length ? d.call.map((i) => <CallCard key={i.id} d={d} i={i} />) : <p className="muted">Nothing reached CALL this week — see Watch below.</p>}

          {d.watch.length > 0 && (
            <>
              <h2>🟡 Watch <span className="chip watch">{d.watch.length}</span></h2>
              {d.watch.map((i) => <WatchCard key={i.id} d={d} i={i} />)}
            </>
          )}

          {d.policy.length > 0 && (
            <>
              <h2>🏛 Policy watch <span className="chip policy">{d.policy.length}</span></h2>
              {d.policy.map((i) => <PolicyCard key={i.id} i={i} />)}
            </>
          )}
        </>
      )}

      <h2>How this week was built</h2>
      <div className="panel">
        <div className="funnel">
          <span><b>{s.fetched}</b> fetched</span><span className="arrow">→</span>
          <span><b>{s.afterDate}</b> in 7-day window</span><span className="arrow">→</span>
          <span><b>{s.afterDedupe}</b> after dedupe</span><span className="arrow">→</span>
          <span><b>{s.afterPrefilter}</b> after keyword pre-filter</span><span className="arrow">→</span>
          <span><b>{s.classifiedByLlm}</b> classified by Gemini{s.classifiedByRules ? <> + <b>{s.classifiedByRules}</b> by rules</> : null}</span><span className="arrow">→</span>
          <span><b>{d.call.length + d.watch.length + d.policy.length}</b> in digest</span>
        </div>
        <div className="sub" style={{ marginTop: 8 }}>
          {s.injectionFlags} prompt-injection flag(s) · {s.unverified} item(s) with unverified evidence (penalised, never CALL)
        </div>
      </div>

      <details>
        <summary>Source health ({d.sourceStatus.filter((x) => x.ok).length}/{d.sourceStatus.length} OK)</summary>
        <div className="scroll">
          <table>
            <thead><tr><th>Source</th><th>Status</th><th>Items</th><th>Time</th><th>Note</th></tr></thead>
            <tbody>
              {d.sourceStatus.map((x) => (
                <tr key={x.name}>
                  <td>{x.name}</td>
                  <td className={x.ok ? "ok" : "bad"}>{x.ok ? "OK" : "FAILED"}</td>
                  <td>{x.count}</td>
                  <td>{(x.ms / 1000).toFixed(1)}s</td>
                  <td className="muted">{x.error ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="sub">One failing source never stops the run — the others carry on.</p>
      </details>

      <details id="skipped">
        <summary>Skipped {d.skipped.length} items (and why)</summary>
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
  );
}
