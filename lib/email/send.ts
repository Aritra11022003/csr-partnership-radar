/**
 * Sends the digest ONLY to the NGO's own configured recipients (G20: the system never contacts companies).
 */
import type { AppConfig, Digest } from "../types";
import { redact } from "../util";
import { renderEmailHtml, renderEmailSubject, renderEmailText } from "./render";

export async function sendDigestEmail(d: Digest, config: AppConfig): Promise<NonNullable<Digest["emailed"]>> {
  const to = config.org.recipients.filter((r) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r));
  const at = new Date().toISOString();
  const key = process.env.RESEND_API_KEY;
  if (!key) return { at, to, error: "RESEND_API_KEY not set — digest stored and shown on dashboard only" };
  if (!to.length) return { at, to, error: "no recipients configured" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.DIGEST_FROM_EMAIL || "CSR Radar <onboarding@resend.dev>",
        to,
        subject: renderEmailSubject(d),
        html: renderEmailHtml(d),
        text: renderEmailText(d),
      }),
    });
    const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) return { at, to, error: redact(`Resend ${res.status}: ${json.message ?? "error"}`) };
    return { at, to, id: json.id };
  } catch (e) {
    return { at, to, error: redact((e as Error).message) };
  }
}
