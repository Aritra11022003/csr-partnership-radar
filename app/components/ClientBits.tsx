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
    localStorage.setItem(TOKEN_KEY, t);
  } catch {
    /* private mode */
  }
}
export function askToken(): string | null {
  const existing = getToken();
  if (existing) return existing;
  const t = window.prompt("Admin token (ADMIN_TOKEN) — stored only in this browser:");
  if (t) setToken(t.trim());
  return t?.trim() || null;
}

export function Toast({ msg, onDone }: { msg: string | null; onDone: () => void }) {
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(onDone, 5000);
    return () => clearTimeout(t);
  }, [msg, onDone]);
  return msg ? <div className="toast" role="status">{msg}</div> : null;
}

export function RunNowButton({ label = "Run now" }: { label?: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [send, setSend] = useState(false);
  const router = useRouter();
  async function run() {
    const token = askToken();
    if (!token) return;
    setBusy(true);
    setMsg("Running: fetching live sources, classifying with Gemini… (≈1 min)");
    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "x-admin-token": token, "Content-Type": "application/json" },
        body: JSON.stringify({ sendEmail: send }),
      });
      if (res.status === 401) {
        setToken("");
        setMsg("Wrong admin token.");
        return;
      }
      const j = await res.json();
      if (!j.ok) setMsg(`Run failed: ${j.error}`);
      else {
        setMsg(`Done: ${j.call} call · ${j.watch} watch · ${j.policy} policy${j.emailed ? (j.emailed.error ? ` · email: ${j.emailed.error}` : " · email sent") : ""}`);
        router.refresh();
      }
    } catch (e) {
      setMsg(`Run failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="row" style={{ gap: 8 }}>
      <label className="sub" style={{ display: "inline-flex", gap: 6, alignItems: "center", margin: 0, fontWeight: 400 }}>
        <input type="checkbox" checked={send} onChange={(e) => setSend(e.target.checked)} /> also email
      </label>
      <button className="btn primary" onClick={run} disabled={busy}>
        {busy ? "Running…" : `▶ ${label}`}
      </button>
      <Toast msg={msg} onDone={() => setMsg(null)} />
    </span>
  );
}

export function FeedbackButtons({ d, i, sigs, initial }: { d: string; i: string; sigs: Record<"up" | "down" | "called", string>; initial?: string | null }) {
  const [state, setState] = useState<string | null>(initial ?? null);
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
