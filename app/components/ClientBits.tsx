"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const TOKEN_KEY = "csr-radar-admin-token";
export function getToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}
export function setToken(t: string) {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode */
  }
}

export function Toast({ msg, onDone }: { msg: string | null; onDone: () => void }) {
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(onDone, 6000);
    return () => clearTimeout(t);
  }, [msg, onDone]);
  return msg ? <div className="toast" role="status">{msg}</div> : null;
}

/** Admin unlock dialog — explains why a token is needed instead of a bare browser prompt. */
export function AdminDialog({ purpose, onClose, onToken }: { purpose: string; onClose: () => void; onToken: (t: string) => void }) {
  const [v, setV] = useState("");
  return (
    <div className="scrim" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="display">Admin access</h3>
        <p>{purpose}</p>
        <ul>
          <li>Reading digests is public. Only <b>actions</b> are protected.</li>
          <li>A run spends Gemini quota and can email the team, so it needs the <span className="code">ADMIN_TOKEN</span> set in Vercel.</li>
          <li>The Monday cron runs on its own with a separate secret.</li>
        </ul>
        <label htmlFor="tok">Admin token</label>
        <input id="tok" type="password" autoFocus value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && v && onToken(v.trim())} placeholder="Paste ADMIN_TOKEN" />
        <p className="sub">Remembered only in this browser.</p>
        <div className="actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn dark" disabled={!v} onClick={() => onToken(v.trim())}>Unlock</button>
        </div>
      </div>
    </div>
  );
}

const STEPS = ["Fetching live news (Google News, CSR feeds, PIB, GDELT)", "Cleaning, deduping, 7-day window", "Gemini Flash classifying candidates", "Scoring + verifying evidence", "Gemini writing the digest"];

export function RunNowButton({ hero = false }: { hero?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [ask, setAsk] = useState(false);
  const [send, setSend] = useState(false);
  const [step, setStep] = useState(0);
  const router = useRouter();

  async function run(token: string) {
    setAsk(false);
    setBusy(true);
    setStep(0);
    const tick = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 14000);
    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "x-admin-token": token, "Content-Type": "application/json" },
        body: JSON.stringify({ sendEmail: send }),
      });
      if (res.status === 401) {
        setToken("");
        setMsg("That token didn't match ADMIN_TOKEN.");
        return;
      }
      setToken(token);
      const j = await res.json();
      if (!j.ok) setMsg(`Run failed: ${j.error}`);
      else {
        setMsg(`Done: ${j.call} to call · ${j.watch} to watch · ${j.policy} policy${j.emailed ? (j.emailed.error ? ` · email: ${j.emailed.error}` : " · email sent") : ""}`);
        router.refresh();
      }
    } catch (e) {
      setMsg(`Run failed: ${(e as Error).message}`);
    } finally {
      clearInterval(tick);
      setBusy(false);
    }
  }

  return (
    <span className="row" style={{ gap: 10 }}>
      <label className="sub" style={{ display: "inline-flex", gap: 6, alignItems: "center", margin: 0, fontWeight: 400, color: hero ? "var(--hero-muted)" : undefined }}>
        <input type="checkbox" checked={send} onChange={(e) => setSend(e.target.checked)} /> email the digest
      </label>
      <button className="btn primary" onClick={() => (getToken() ? run(getToken()) : setAsk(true))} disabled={busy}>
        {busy ? "Running…" : "▶ Run now"}
      </button>
      {ask && <AdminDialog purpose="Run the full pipeline now on live data." onClose={() => setAsk(false)} onToken={run} />}
      {busy && (
        <div className="scrim">
          <div className="modal">
            <h3 className="display">Building this week’s digest…</h3>
            <p>Live sources, then Gemini Flash. Usually takes about a minute.</p>
            <div className="steps">
              {STEPS.map((s, i) => (
                <div key={s} className={i < step ? "done" : ""}>{i < step ? "✓" : i === step ? "●" : "○"} {s}</div>
              ))}
            </div>
            <div className="progress"><div /></div>
          </div>
        </div>
      )}
      <Toast msg={msg} onDone={() => setMsg(null)} />
    </span>
  );
}

export function FeedbackButtons({ d, i, sigs }: { d: string; i: string; sigs: Record<"up" | "down" | "called", string> }) {
  const [state, setState] = useState<string | null>(null);
  async function send(k: "up" | "down" | "called") {
    setState(k);
    await fetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ d, i, k, s: sigs[k] }) }).catch(() => setState(null));
  }
  return (
    <div className="fb">
      <button className={`btn ${state === "up" ? "on" : ""}`} onClick={() => send("up")}>👍 Useful</button>
      <button className={`btn ${state === "down" ? "on" : ""}`} onClick={() => send("down")}>👎 Not useful</button>
      <button className={`btn ${state === "called" ? "on" : ""}`} onClick={() => send("called")}>📞 Called</button>
    </div>
  );
}
