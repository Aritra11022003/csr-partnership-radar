"use client";
import { useState } from "react";
import type { ScoringConfig } from "@/lib/types";

/** Interactive demo of the scoring rules — mirrors lib/pipeline/score.ts, runs only in the browser. */
export function VerdictSimulator({ scoring: sc, geos }: { scoring: ScoringConfig; geos: { label: string; tier: number }[] }) {
  const [signal, setSignal] = useState<keyof ScoringConfig["signal_weight"]>("PARTNER_SEARCH");
  const [sector, setSector] = useState<"primary" | "secondary" | "none">("primary");
  const [tier, setTier] = useState<string>(String(geos[0]?.tier ?? 1));
  const [recency, setRecency] = useState(Object.keys(sc.recency)[0]);
  const [watch, setWatch] = useState(false);
  const [cred, setCred] = useState<"high" | "medium" | "low">("high");
  const [quoted, setQuoted] = useState(true);
  const [clear, setClear] = useState(true);
  const [suspicious, setSuspicious] = useState(false);

  const parts: [string, number][] = [
    ["Signal", sc.signal_weight[signal]],
    ["Sector fit", sector === "primary" ? sc.sector_match.primary : sector === "secondary" ? sc.sector_match.secondary : 0],
    ["Location", tier === "unknown" ? (sc.geo_weight.unknown ?? 0) : (sc.geo_weight[tier] ?? 0)],
    ["Recency", sc.recency[recency] ?? 0],
    ["Watchlist", watch ? sc.watchlist_bonus : 0],
    ["Source", sc.source_credibility[cred]],
    ["Quote check", quoted ? 0 : sc.unverified_evidence_penalty],
  ];
  const irrelevant = sector === "none" && signal !== "POLICY";
  const score = irrelevant ? 0 : parts.reduce((a, [, v]) => a + v, 0);
  let verdict = score >= sc.verdict_thresholds.CALL ? "CALL" : score >= sc.verdict_thresholds.WATCH ? "WATCH" : "SKIP";
  const why: string[] = [];
  if (irrelevant) {
    verdict = "SKIP";
    why.push("Not in one of your sectors, so it’s skipped.");
  }
  if (signal === "PARTNER_SEARCH" && quoted && sector === "primary" && verdict === "SKIP") {
    verdict = "WATCH";
    why.push("A confirmed partner search in your sector is always at least WATCH.");
  }
  if (verdict === "CALL" && !quoted) {
    verdict = "WATCH";
    why.push("The quote wasn’t found word-for-word, so it can’t be a CALL.");
  }
  if (verdict === "CALL" && !clear) {
    verdict = "WATCH";
    why.push("The article is too vague to be sure, so it stays on WATCH.");
  }
  if (verdict === "CALL" && suspicious) {
    verdict = "WATCH";
    why.push("Suspicious text was detected, so it’s capped at WATCH.");
  }
  if (signal === "POLICY") {
    verdict = "POLICY";
    why.push("Policy changes always go to the Policy section.");
  }
  if (!why.length)
    why.push(
      verdict === "CALL"
        ? `Score ${score} clears the CALL bar of ${sc.verdict_thresholds.CALL}.`
        : verdict === "WATCH"
          ? `Score ${score} is between ${sc.verdict_thresholds.WATCH} and ${sc.verdict_thresholds.CALL - 1}.`
          : `Score ${score} is below the WATCH bar of ${sc.verdict_thresholds.WATCH}.`,
    );

  const pct = Math.max(0, Math.min(100, score));
  const color = verdict === "CALL" ? "var(--call)" : verdict === "WATCH" ? "var(--watch)" : verdict === "POLICY" ? "var(--policy)" : "var(--muted)";

  return (
    <div className="sim">
      <div className="sim-form">
        <label>What happened?
          <select value={signal} onChange={(e) => setSignal(e.target.value as typeof signal)}>
            <option value="PARTNER_SEARCH">Company is seeking NGO partners</option>
            <option value="NEW_INITIATIVE">New CSR programme announced</option>
            <option value="ALLOCATION_UP">CSR budget increased</option>
            <option value="POLICY">CSR rule / policy change</option>
          </select>
        </label>
        <label>Fits our sectors?
          <select value={sector} onChange={(e) => setSector(e.target.value as typeof sector)}>
            <option value="primary">Yes, a main focus sector</option>
            <option value="secondary">Partly / related sector</option>
            <option value="none">No</option>
          </select>
        </label>
        <label>Where?
          <select value={tier} onChange={(e) => setTier(e.target.value)}>
            {geos.map((g) => <option key={g.label} value={String(g.tier)}>{g.label}</option>)}
            <option value="unknown">Not stated / elsewhere in India</option>
          </select>
        </label>
        <label>How recent?
          <select value={recency} onChange={(e) => setRecency(e.target.value)}>
            {Object.keys(sc.recency).map((k) => <option key={k} value={k}>{k.replace("d", " days ago")}</option>)}
          </select>
        </label>
        <label>Source
          <select value={cred} onChange={(e) => setCred(e.target.value as typeof cred)}>
            <option value="high">Major business paper / govt site</option>
            <option value="medium">CSR trade site</option>
            <option value="low">Other website</option>
          </select>
        </label>
        <div className="sim-checks">
          <label><input type="checkbox" checked={watch} onChange={(e) => setWatch(e.target.checked)} /> Company is on our watchlist</label>
          <label><input type="checkbox" checked={quoted} onChange={(e) => setQuoted(e.target.checked)} /> Quote found word-for-word</label>
          <label><input type="checkbox" checked={clear} onChange={(e) => setClear(e.target.checked)} /> Article is clear (not vague)</label>
          <label><input type="checkbox" checked={suspicious} onChange={(e) => setSuspicious(e.target.checked)} /> Text looks suspicious</label>
        </div>
      </div>
      <div className="sim-out" style={{ ["--vc" as string]: color }}>
        <div className="sim-verdict">{verdict === "SKIP" ? "SKIPPED" : verdict}</div>
        <div className="sim-score">{irrelevant ? "—" : score}<small> / 100</small></div>
        <div className="sim-bar"><div style={{ width: `${pct}%` }} /><i style={{ left: `${sc.verdict_thresholds.WATCH}%` }} title="WATCH bar" /><i style={{ left: `${sc.verdict_thresholds.CALL}%` }} title="CALL bar" /></div>
        <ul className="sim-why">{why.map((w) => <li key={w}>{w}</li>)}</ul>
        <table className="sim-parts">
          <tbody>
            {parts.map(([k, v]) => (
              <tr key={k}><td>{k}</td><td style={{ color: v < 0 ? "var(--danger)" : undefined }}>{v > 0 ? `+${v}` : v}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
