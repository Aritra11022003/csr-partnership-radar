"use client";
import { useEffect, useState } from "react";
import type { AppConfig } from "@/lib/types";
import { AdminDialog, getToken, setToken, Toast } from "../components/ClientBits";

const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const join = (a: string[]) => a.join(", ");
const SIGNALS = ["PARTNER_SEARCH", "NEW_INITIATIVE", "ALLOCATION_UP", "POLICY"] as const;

export function SettingsForm() {
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [source, setSource] = useState("");
  const [queries, setQueries] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [watchText, setWatchText] = useState("");
  const [ask, setAsk] = useState(false);
  const [showQ, setShowQ] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((j) => {
        setCfg(j.config);
        setSource(j.source);
        setQueries(j.queries);
        setWatchText(j.config.watchlist.map((c: AppConfig["watchlist"][number]) => `${c.name} | ${join(c.aliases)} | ${c.hq_geo}`).join("\n"));
      });
  }, []);

  if (!cfg) return <p className="muted">Loading…</p>;
  const up = (f: (c: AppConfig) => void) => {
    const c = structuredClone(cfg);
    f(c);
    setCfg(c);
  };

  function save() {
    const t = getToken();
    if (t) void doSave(t);
    else setAsk(true);
  }

  function currentConfig(): AppConfig | null {
    if (!cfg) return null;
    const c = structuredClone(cfg);
    c.watchlist = watchText
      .split("\n")
      .map((l) => l.split("|").map((x) => x.trim()))
      .filter((p) => p[0])
      .map(([name, aliases = "", hq = "pan_india"]) => ({ name, aliases: list(aliases), hq_geo: hq || "pan_india" }));
    return c;
  }

  /** Guest-friendly: shows the queries this configuration would produce, without saving anything. */
  async function preview() {
    setAsk(false);
    const c = currentConfig();
    if (!c) return;
    const res = await fetch("/api/settings/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(c) });
    const j = await res.json();
    if (!j.ok) return setMsg(`Invalid settings: ${j.error}`);
    setQueries(j.queries);
    setShowQ(true);
    setMsg(`Preview only, not saved: the next run would use ${j.queries.length} search queries (listed below).`);
  }

  async function doSave(token: string) {
    setAsk(false);
    if (!cfg) return;
    const c = structuredClone(cfg);
    c.watchlist = watchText
      .split("\n")
      .map((l) => l.split("|").map((x) => x.trim()))
      .filter((p) => p[0])
      .map(([name, aliases = "", hq = "pan_india"]) => ({ name, aliases: list(aliases), hq_geo: hq || "pan_india" }));
    setSaving(true);
    const res = await fetch("/api/settings", { method: "PUT", headers: { "x-admin-token": token, "Content-Type": "application/json" }, body: JSON.stringify(c) });
    setSaving(false);
    if (res.status === 401) {
      setToken("");
      setMsg("Wrong admin token — not saved.");
      return;
    }
    const j = await res.json();
    if (!res.ok) return setMsg(`Not saved: ${j.error}`);
    setToken(token);
    setQueries(j.queries);
    setSource("store");
    setMsg(`Saved. The next run will use ${j.queries.length} search queries.`);
  }

  return (
    <div>
      <div className="row spread" style={{ margin: "10px 0 16px" }}>
        <span className="sub">Currently using: <b>{source === "store" ? "saved settings" : "seed defaults"}</b></span>
        <span className="row" style={{ gap: 8 }}>
          <button className="btn" onClick={preview}>Preview effect (no save)</button>
          <button className="btn primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save settings"}</button>
        </span>
      </div>

      <div className="grid2">
        <div className="panel">
          <h3>Recipients</h3>
          <p className="sub">The digest only ever goes to these addresses. Companies are never contacted.</p>
          <input type="text" value={join(cfg.org.recipients)} onChange={(e) => up((c) => (c.org.recipients = list(e.target.value)))} />
          <label>Look-back window (days)</label>
          <input type="number" min={1} max={31} value={cfg.lookback_days} onChange={(e) => up((c) => (c.lookback_days = Number(e.target.value)))} />
        </div>
        <div className="panel">
          <h3>Verdict thresholds</h3>
          <p className="sub">Score ≥ CALL → “worth a call this week”. Score ≥ WATCH → watch list. Low confidence, unverified evidence or injection never reach CALL.</p>
          <div className="row">
            <div style={{ flex: 1 }}><label>CALL ≥</label><input type="number" value={cfg.scoring.verdict_thresholds.CALL} onChange={(e) => up((c) => (c.scoring.verdict_thresholds.CALL = Number(e.target.value)))} /></div>
            <div style={{ flex: 1 }}><label>WATCH ≥</label><input type="number" value={cfg.scoring.verdict_thresholds.WATCH} onChange={(e) => up((c) => (c.scoring.verdict_thresholds.WATCH = Number(e.target.value)))} /></div>
          </div>
        </div>
      </div>

      <div className="panel">
        <h3>Focus sectors</h3>
        <p className="sub">Disable a sector or edit its keywords; add new sectors as the programme footprint grows.</p>
        {cfg.sectors.map((s, n) => (
          <div key={n} className="row" style={{ alignItems: "flex-start", borderTop: n ? "1px solid var(--line)" : "none", paddingTop: n ? 10 : 0, marginTop: 10 }}>
            <label style={{ display: "inline-flex", gap: 6, alignItems: "center", width: 30, marginTop: 30 }}>
              <input type="checkbox" checked={s.enabled} onChange={(e) => up((c) => (c.sectors[n].enabled = e.target.checked))} />
            </label>
            <div style={{ flex: "0 0 200px" }}>
              <label>Label</label>
              <input type="text" value={s.label} onChange={(e) => up((c) => (c.sectors[n].label = e.target.value))} />
              <div className="sub code" style={{ marginTop: 4, display: "inline-block" }}>{s.id}</div>
            </div>
            <div style={{ flex: 1, minWidth: 220 }}>
              <label>Keywords (comma-separated)</label>
              <textarea value={join(s.keywords)} onChange={(e) => up((c) => (c.sectors[n].keywords = list(e.target.value)))} />
            </div>
          </div>
        ))}
        <button
          className="btn"
          style={{ marginTop: 12 }}
          onClick={() => {
            const label = window.prompt("New sector name (e.g. Women Livelihoods)");
            if (!label) return;
            up((c) => c.sectors.push({ id: label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""), label, enabled: true, keywords: [label.toLowerCase()] }));
          }}
        >
          + Add sector
        </button>
      </div>

      <div className="panel">
        <h3>Geographic priority</h3>
        <p className="sub">Tier 1 scores highest. Aliases are matched in article text, in code.</p>
        <div className="scroll">
          <table>
            <thead><tr><th style={{ width: 160 }}>Region</th><th style={{ width: 80 }}>Tier</th><th style={{ width: 90 }}>Points</th><th>Aliases</th></tr></thead>
            <tbody>
              {[...cfg.geographies].map((g, n) => (
                <tr key={n}>
                  <td><input type="text" value={g.label} onChange={(e) => up((c) => (c.geographies[n].label = e.target.value))} /></td>
                  <td><input type="number" min={1} max={9} value={g.tier} onChange={(e) => up((c) => (c.geographies[n].tier = Number(e.target.value)))} /></td>
                  <td>
                    <input type="number" value={cfg.scoring.geo_weight[String(g.tier)] ?? 0} onChange={(e) => up((c) => (c.scoring.geo_weight[String(g.tier)] = Number(e.target.value)))} />
                  </td>
                  <td><input type="text" value={join(g.aliases)} onChange={(e) => up((c) => (c.geographies[n].aliases = list(e.target.value)))} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          className="btn"
          style={{ marginTop: 10 }}
          onClick={() => {
            const label = window.prompt("Region name (e.g. Karnataka)");
            if (!label) return;
            up((c) => c.geographies.push({ id: label.toLowerCase().replace(/[^a-z0-9]+/g, "_"), label, tier: 3, aliases: [label] }));
          }}
        >
          + Add region
        </button>
      </div>

      <div className="grid2">
        <div className="panel">
          <h3>Signal weights</h3>
          {SIGNALS.map((s) => (
            <div key={s} className="row" style={{ marginTop: 6 }}>
              <span className="code" style={{ flex: 1 }}>{s}</span>
              <input type="number" style={{ width: 90 }} value={cfg.scoring.signal_weight[s]} onChange={(e) => up((c) => (c.scoring.signal_weight[s] = Number(e.target.value)))} />
            </div>
          ))}
          <label>Watchlist bonus</label>
          <input type="number" value={cfg.scoring.watchlist_bonus} onChange={(e) => up((c) => (c.scoring.watchlist_bonus = Number(e.target.value)))} />
          <label>Unverified-evidence penalty</label>
          <input type="number" value={cfg.scoring.unverified_evidence_penalty} onChange={(e) => up((c) => (c.scoring.unverified_evidence_penalty = Number(e.target.value)))} />
        </div>
        <div className="panel">
          <h3>Signal trigger phrases</h3>
          <p className="sub">Used for search queries and the deterministic pre-filter.</p>
          {SIGNALS.map((s) => (
            <div key={s}>
              <label>{s}</label>
              <textarea style={{ minHeight: 48 }} value={join(cfg.signal_keywords[s])} onChange={(e) => up((c) => (c.signal_keywords[s] = list(e.target.value)))} />
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <h3>Watchlist companies</h3>
        <p className="sub">One per line: <span className="code">Name | alias, alias | hq_geo</span>. Names only — amounts and contacts always come from live sources.</p>
        <textarea style={{ minHeight: 220, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 13 }} value={watchText} onChange={(e) => setWatchText(e.target.value)} />
      </div>

      <details open={showQ} onToggle={(e) => setShowQ((e.target as HTMLDetailsElement).open)}>
        <summary>Search queries the next run will use ({queries.length})</summary>
        <ol className="sub" style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12 }}>
          {queries.map((q) => <li key={q}>{q}</li>)}
        </ol>
      </details>

      <div className="row" style={{ justifyContent: "flex-end", marginTop: 14 }}>
        <button className="btn" onClick={preview}>Preview effect (no save)</button>
        <button className="btn primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save settings"}</button>
      </div>
      {ask && (
        <AdminDialog
          purpose="Save these settings. They change next run's search queries and scores."
          onClose={() => setAsk(false)}
          onToken={doSave}
          onGuest={preview}
          guestNote="Guests can't save, but can preview exactly how these changes would alter the next run's searches."
        />
      )}
      <Toast msg={msg} onDone={() => setMsg(null)} />
    </div>
  );
}
