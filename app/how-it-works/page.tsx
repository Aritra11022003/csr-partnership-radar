import Link from "next/link";
import { loadConfig } from "@/lib/config";
import { latestSampleId } from "@/lib/run";
import { IconHandshake, IconLandmark, IconRocket, IconTrend } from "../components/Icons";
import { VerdictSimulator } from "./VerdictSimulator";

export const dynamic = "force-dynamic";

export default async function Guide() {
  const { config } = await loadConfig();
  const sc = config.scoring;
  const sampleId = await latestSampleId().catch(() => null);
  const sectors = config.sectors.filter((s) => s.enabled).map((s) => s.label);
  const geos = [...config.geographies].sort((a, b) => a.tier - b.tier);

  return (
    <div className="wrap page guide">
      <div className="eyebrow">Rule guide</div>
      <h1 className="display">How the radar works for you</h1>
      <p className="lead">
        Every <b>Monday at 7:00 am</b> you get one short email covering the past 7 days of CSR news in{" "}
        <b>{sectors.join(", ")}</b>. Each item answers one question: <b>is this worth a call this week?</b>{" "}
        You make the call. The radar never contacts anyone for you.
      </p>

      <h2>Your Monday in three steps</h2>
      <div className="steps3">
        <div className="s3"><span>1</span><h4>Read the “Call this week” list</h4><p>These are the strongest, freshest openings. Start your outreach here.</p></div>
        <div className="s3"><span>2</span><h4>Skim Watch and Policy</h4><p>Watch items aren’t urgent yet but may become calls. Policy items change how funders spend.</p></div>
        <div className="s3"><span>3</span><h4>Tap feedback</h4><p>👍 Useful, 👎 Not useful, or 📞 Called. Next week’s ranking learns from it.</p></div>
      </div>

      <h2>The four signals it looks for</h2>
      <div className="sig4">
        <div className="sigc" style={{ ["--c" as string]: "#138a52" }}>
          <div className="ic"><IconHandshake size={20} /></div>
          <h4>Partner search</h4>
          <p className="when">A company is openly looking for NGO or implementation partners: “inviting proposals”, “RFP”, “expression of interest”, “empanelment”.</p>
          <p className="act"><b>What to do:</b> the hottest signal. Reach out before partners are chosen and note any deadline.</p>
        </div>
        <div className="sigc" style={{ ["--c" as string]: "#3b4fd6" }}>
          <div className="ic"><IconRocket size={20} /></div>
          <h4>New initiative</h4>
          <p className="when">A new CSR programme, foundation drive or MoU in one of your sectors was just announced.</p>
          <p className="act"><b>What to do:</b> they’re actively spending. Pitch where your programme fits theirs.</p>
        </div>
        <div className="sigc" style={{ ["--c" as string]: "#c27c00" }}>
          <div className="ic"><IconTrend size={20} /></div>
          <h4>Budget up</h4>
          <p className="when">Press or annual-report coverage shows a company raising its CSR spend or earmarking new money.</p>
          <p className="act"><b>What to do:</b> a good moment for a relationship call before next year’s plan is fixed.</p>
        </div>
        <div className="sigc" style={{ ["--c" as string]: "#6a5ae0" }}>
          <div className="ic"><IconLandmark size={20} /></div>
          <h4>Policy change</h4>
          <p className="when">A government or regulatory change to CSR rules (Ministry of Corporate Affairs, Schedule VII, unspent CSR funds).</p>
          <p className="act"><b>What to do:</b> use it as a reason to check in with current and prospective funders.</p>
        </div>
      </div>
      <p className="note">
        <b>“Partners with X” is not a partner search.</b> It means a partner has already been chosen, so it’s treated as a new initiative.
      </p>

      <h2>What each verdict means</h2>
      <div className="verd">
        <div className="vrow call"><b>CALL</b><span>Score {sc.verdict_thresholds.CALL}+ with a clear, quoted source. Worth a call this week.</span></div>
        <div className="vrow watch"><b>WATCH</b><span>Score {sc.verdict_thresholds.WATCH}–{sc.verdict_thresholds.CALL - 1}, or anything the radar isn’t fully sure about. Keep an eye on it; no action needed yet.</span></div>
        <div className="vrow policy"><b>POLICY</b><span>A rule change, always shown in its own section whatever its score.</span></div>
        <div className="vrow skip"><b>SKIPPED</b><span>Below {sc.verdict_thresholds.WATCH}, outside your sectors, outside India, or not CSR at all (e.g. share-price news). Listed at the bottom of each digest so you can check.</span></div>
      </div>

      <h2>How an item earns its score</h2>
      <p className="muted">Points add up to a score out of about 100. These are your current settings; change them anytime in <Link href="/settings">Settings</Link>.</p>
      <div className="panel scroll">
        <table className="ptable">
          <tbody>
            <tr><td><b>Type of signal</b></td><td>Partner search <b>+{sc.signal_weight.PARTNER_SEARCH}</b> · New initiative <b>+{sc.signal_weight.NEW_INITIATIVE}</b> · Budget up <b>+{sc.signal_weight.ALLOCATION_UP}</b> · Policy <b>+{sc.signal_weight.POLICY}</b></td></tr>
            <tr><td><b>Fits your sectors</b></td><td>Main sector <b>+{sc.sector_match.primary}</b> · Related sector <b>+{sc.sector_match.secondary}</b></td></tr>
            <tr><td><b>Location</b></td><td>{geos.map((g, k) => <span key={g.id}>{k ? " · " : ""}{g.label} <b>+{sc.geo_weight[String(g.tier)] ?? 0}</b></span>)} · Not stated <b>+{sc.geo_weight.unknown ?? 0}</b></td></tr>
            <tr><td><b>How recent</b></td><td>{Object.entries(sc.recency).map(([k, v], n) => <span key={k}>{n ? " · " : ""}{k.replace("d", " days")} <b>+{v}</b></span>)}</td></tr>
            <tr><td><b>Company on your watchlist</b></td><td><b>+{sc.watchlist_bonus}</b></td></tr>
            <tr><td><b>Source</b></td><td>Major business paper or government site <b>+{sc.source_credibility.high}</b> · CSR trade site <b>+{sc.source_credibility.medium}</b></td></tr>
            <tr><td><b>Quote not found word-for-word</b></td><td><b>{sc.unverified_evidence_penalty}</b> and it can never be a CALL</td></tr>
            <tr><td><b>Your feedback</b></td><td>Companies you mark 👍 or 📞 get a small boost next time; 👎 a small drop (at most ±5)</td></tr>
          </tbody>
        </table>
      </div>

      <h2>Hard rules (these override the score)</h2>
      <div className="gcards">
        <div className="gcard"><b>📌 No quote, no call</b><span>Every item shows a sentence copied word-for-word from the source. If it can’t be matched exactly, the item is capped at WATCH.</span></div>
        <div className="gcard"><b>🔍 Unsure means WATCH</b><span>If the article is short or vague, the item can’t be a CALL however high it scores.</span></div>
        <div className="gcard"><b>🚩 Suspicious text means WATCH</b><span>If an article seems written to game the system, it’s flagged and capped at WATCH.</span></div>
        <div className="gcard"><b>🤝 Partner searches always show</b><span>A confirmed partner search in your sectors is always at least WATCH, never silently dropped.</span></div>
        <div className="gcard"><b>🔢 No guessed numbers</b><span>Amounts, beneficiary counts and deadlines appear only if the article states them.</span></div>
        <div className="gcard"><b>🗓 Last 7 days only</b><span>Older news is dropped, and stories already shown in an earlier week aren’t repeated.</span></div>
        <div className="gcard"><b>🔗 Always a source</b><span>Every item links to the original article and shows its date, so you can verify before you call.</span></div>
        <div className="gcard"><b>📭 Quiet weeks are OK</b><span>If nothing qualifies, you get a short “no strong signals” note, not filler.</span></div>
      </div>

      <h2>Try it: how would an item be rated?</h2>
      <p className="muted">Pick the details of a news item and see the score and verdict the radar would give it, using your current settings.</p>
      <VerdictSimulator scoring={sc} geos={geos.map((g) => ({ label: g.label, tier: g.tier }))} />

      <h2>Reading an item card</h2>
      <div className="panel">
        <ul className="anatomy">
          <li><b>Headline</b> with the company name first</li>
          <li><b>Tags:</b> sector · location · amount, people reached and deadline (only if stated)</li>
          <li><b>Context:</b> what was announced and why it fits your work</li>
          <li><b>Why now:</b> the timing reason, e.g. a deadline, a fresh launch or partners not yet chosen</li>
          <li><b>Angle:</b> a suggested pitch hook, not a promise</li>
          <li><b>Quote:</b> the exact sentence from the source that backs it up</li>
          <li><b>Source link and date</b>, plus other outlets that reported it</li>
          <li><b>Score ring</b> out of 100, and feedback buttons</li>
        </ul>
        {sampleId && (
          <p style={{ marginBottom: 0 }}>
            <Link href={`/digest/${sampleId}`}>See a worked example with CALL items (sample data, fictional companies) →</Link>
          </p>
        )}
      </div>

      <h2>Making it yours</h2>
      <div className="gcards">
        <div className="gcard"><b>Sectors & keywords</b><span>Add a new focus area (e.g. women’s livelihoods) or switch one off as your programmes grow.</span></div>
        <div className="gcard"><b>Places</b><span>Change the priority order, e.g. move Maharashtra up, or add a new state you now work in.</span></div>
        <div className="gcard"><b>Watchlist</b><span>Add companies you’re courting. Their news gets a small boost.</span></div>
        <div className="gcard"><b>Thresholds & recipients</b><span>Make CALL stricter or looser, and choose who gets the Monday email.</span></div>
      </div>
      <p className="muted">Changes apply from the next run. Saving needs the admin token so only your team can change them.</p>

      <h2>What the radar will never do</h2>
      <ul className="never">
        <li>Contact companies, send outreach or reply on your behalf</li>
        <li>Collect personal phone numbers or emails; it works at company level only</li>
        <li>Read paywalled articles; it uses public headlines and summaries</li>
        <li>Invent amounts, names or deadlines</li>
      </ul>

      <h2>Questions</h2>
      <details><summary>Why are there zero CALL items this week?</summary><p className="muted">A CALL needs a strong signal in your sectors, ideally near Pune, quoted clearly from a recent article. In weeks without one the radar says so honestly rather than inflating a weaker item. Check the Watch list.</p></details>
      <details><summary>Can I trust the summaries?</summary><p className="muted">They’re AI-written, but each item carries an exact quote and a link to the original. Read the quote; if it doesn’t support the headline, mark 👎. Always verify before outreach.</p></details>
      <details><summary>Why did I get the same company twice?</summary><p className="muted">It shouldn’t happen within a week: duplicate stories are merged and listed as extra sources. Across weeks, a story is only repeated if there is genuinely new coverage.</p></details>
      <details><summary>What does “Run now” do?</summary><p className="muted">It builds a fresh digest immediately instead of waiting for Monday. It’s admin-only because each run uses a limited daily AI allowance and can send the email.</p></details>
    </div>
  );
}
