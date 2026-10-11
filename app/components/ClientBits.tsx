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
    window.dispatchEvent(new Event("csr-token"));
  } catch {
    /* private mode */
  }
}

/** Shows whether this browser is in Admin or Guest mode, and lets you switch. */
export function AccessBadge() {
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    const sync = () => setAdmin(!!getToken());
    sync();
    window.addEventListener("csr-token", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("csr-token", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return admin ? (
    <button className="pill pill-btn" title="This browser has the admin token saved" onClick={() => setToken("")}>
      🔓 Admin mode · switch to guest
    </button>
  ) : (
    <span className="pill" title="Actions ask for the admin token, or let you continue as a guest">👤 Guest mode</span>
  );
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
export function AdminDialog({ purpose, onClose, onToken, onGuest, guestNote }: { purpose: string; onClose: () => void; onToken: (t: string) => void; onGuest?: () => void; guestNote?: string }) {
  const [v, setV] = useState("");
  return (
    <div className="scrim" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="display">Admin access</h3>
        <p>{purpose}</p>
        {onGuest && (
          <div className="guest-box">
            <div>
              <b>Just exploring or grading?</b>
              <p className="sub" style={{ margin: "2px 0 0" }}>{guestNote}</p>
            </div>
            <button className="btn primary" onClick={onGuest}>Continue as guest</button>
          </div>
        )}
        <p className="sub" style={{ marginTop: 14 }}>
          Admins have unlimited access. Actions are protected because they use the daily AI allowance and can email the team. Reading digests is always public.
        </p>
        <label htmlFor="tok">Admin token (optional)</label>
        <input id="tok" type="password" autoFocus value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && v && onToken(v.trim())} placeholder="Paste ADMIN_TOKEN" />
        <p className="sub">Remembered only in this browser.</p>
        <div className="actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn dark" disabled={!v} onClick={() => onToken(v.trim())}>Unlock as admin</button>
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
        headers: { ...(token ? { "x-admin-token": token } : {}), "Content-Type": "application/json" },
        body: JSON.stringify({ sendEmail: token ? send : false }),
      });
      if (res.status === 401) {
        setToken("");
        setMsg("That token didn't match ADMIN_TOKEN.");
        return;
      }
      if (token) setToken(token);
      const j = await res.json();
      if (!j.ok) setMsg(j.error?.startsWith("Guest") ? j.error : `Run failed: ${j.error}`);
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
      {ask && (
        <AdminDialog
          purpose="Run the full pipeline now on live data."
          onClose={() => setAsk(false)}
          onToken={run}
          onGuest={() => run("")}
          guestNote="Run the full live pipeline without a token. No email is sent; limited to a few runs per day."
        />
      )}
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

/** Admin: email an existing digest to the configured recipients or custom addresses. */
export function EmailDigestButton({ digestId }: { digestId: string }) {
  const [open, setOpen] = useState(false);
  const [ask, setAsk] = useState(false);
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function openComposer() {
    setOpen(true);
    if (!to) {
      const j = await fetch("/api/settings").then((r) => r.json()).catch(() => null);
      if (j?.config?.org?.recipients) setTo(j.config.org.recipients.join(", "));
    }
  }

  async function send(token: string) {
    setAsk(false);
    setBusy(true);
    try {
      const res = await fetch("/api/send-email", {
        method: "POST",
        headers: { ...(token ? { "x-admin-token": token } : {}), "Content-Type": "application/json" },
        body: JSON.stringify({ id: digestId, to: to.split(",").map((s) => s.trim()).filter(Boolean) }),
      });
      if (res.status === 401) {
        setToken("");
        setMsg("That token didn't match ADMIN_TOKEN.");
        return;
      }
      if (token) setToken(token);
      const j = await res.json();
      if (j.ok) {
        setOpen(false);
        setMsg(`Email sent to ${j.emailed.to.join(", ")}`);
      } else setMsg(`Not sent: ${j.error ?? j.emailed?.error}`);
    } catch (e) {
      setMsg(`Not sent: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="pill pill-btn" onClick={openComposer}>✉ Email this digest</button>
      {open && (
        <div className="scrim" role="dialog" aria-modal="true" onClick={() => !busy && setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="display">Email this digest</h3>
            <p>Sends this digest exactly as shown, with the same layout as the Monday email. Nothing is re-run and no AI quota is used.</p>
            <label htmlFor="rcpt">Recipients (comma-separated, up to 10)</label>
            <input id="rcpt" type="text" value={to} onChange={(e) => setTo(e.target.value)} placeholder="ananya@yourngo.org, team@yourngo.org" />
            <p className="sub">Only your team. The radar never emails companies.</p>
            <div className="actions">
              <button className="btn" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
              <button className="btn dark" disabled={busy || !to.trim()} onClick={() => (getToken() ? send(getToken()) : setAsk(true))}>
                {busy ? "Sending…" : "Send email"}
              </button>
            </div>
          </div>
        </div>
      )}
      {ask && (
        <AdminDialog
          purpose="Send this digest by email."
          onClose={() => setAsk(false)}
          onToken={send}
          onGuest={() => send("")}
          guestNote="Send it to one address of your choice without a token. Limited to a few emails per day."
        />
      )}
      <Toast msg={msg} onDone={() => setMsg(null)} />
    </>
  );
}
