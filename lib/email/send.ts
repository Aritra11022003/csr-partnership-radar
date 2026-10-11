/**
 * Sends the digest ONLY to the NGO's own configured recipients (G20: the system never contacts companies).
 *
 * Providers (first one configured wins):
 *  1. SMTP  — SMTP_HOST/SMTP_USER/SMTP_PASS (e.g. Gmail with an app password). Delivers to any address.
 *  2. Brevo — BREVO_API_KEY + a verified sender in DIGEST_FROM_EMAIL. Delivers to any address.
 *  3. Resend — RESEND_API_KEY. With the sandbox sender (onboarding@resend.dev) Resend only delivers to the
 *     account owner's own address until a domain is verified.
 */
import nodemailer from "nodemailer";
import type { AppConfig, Digest } from "../types";
import { redact } from "../util";
import { renderEmailHtml, renderEmailSubject, renderEmailText } from "./render";

type Result = NonNullable<Digest["emailed"]>;
type Msg = { from: string; to: string[]; subject: string; html: string; text: string };

export function emailProvider(): "smtp" | "brevo" | "resend" | null {
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) return "smtp";
  if (process.env.BREVO_API_KEY) return "brevo";
  if (process.env.RESEND_API_KEY) return "resend";
  return null;
}

function parseFrom(from: string): { name: string; email: string } {
  const m = /^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/.exec(from);
  return m ? { name: m[1].trim() || "CSR Radar", email: m[2].trim() } : { name: "CSR Radar", email: from.trim() };
}

async function viaSmtp(m: Msg): Promise<{ id?: string; error?: string }> {
  const port = Number(process.env.SMTP_PORT || 465);
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  const info = await transport.sendMail({ from: m.from, to: m.to.join(", "), subject: m.subject, html: m.html, text: m.text });
  return { id: info.messageId };
}

async function viaBrevo(m: Msg): Promise<{ id?: string; error?: string }> {
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": process.env.BREVO_API_KEY!, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ sender: parseFrom(m.from), to: m.to.map((email) => ({ email })), subject: m.subject, htmlContent: m.html, textContent: m.text }),
  });
  const json = (await res.json().catch(() => ({}))) as { messageId?: string; message?: string };
  return res.ok ? { id: json.messageId } : { error: `Brevo ${res.status}: ${json.message ?? "error"}` };
}

async function viaResend(m: Msg): Promise<{ id?: string; error?: string }> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(m),
  });
  const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
  if (res.ok) return { id: json.id };
  if (res.status === 403 && /own email address/i.test(json.message ?? "")) {
    const owner = /\(([^)]+@[^)]+)\)/.exec(json.message ?? "")?.[1];
    return { error: `The current email sender is in test mode and can only deliver to ${owner ?? "the account owner"}. Ask the admin to connect a full sender (Gmail SMTP or Brevo) to email other addresses.` };
  }
  return { error: `Resend ${res.status}: ${json.message ?? "error"}` };
}

export async function sendDigestEmail(d: Digest, config: AppConfig): Promise<Result> {
  const to = config.org.recipients.filter((r) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r));
  const at = new Date().toISOString();
  const provider = emailProvider();
  if (!provider) return { at, to, error: "No email provider configured — digest stored and shown on dashboard only" };
  if (!to.length) return { at, to, error: "no recipients configured" };
  // SMTP must send as the mailbox it logs into; Brevo needs its verified sender; Resend uses DIGEST_FROM_EMAIL.
  const from =
    provider === "smtp"
      ? `CSR Radar <${process.env.SMTP_USER}>`
      : provider === "brevo"
        ? process.env.BREVO_SENDER || process.env.DIGEST_FROM_EMAIL || ""
        : process.env.DIGEST_FROM_EMAIL || "CSR Radar <onboarding@resend.dev>";
  const msg: Msg = { from, to, subject: renderEmailSubject(d), html: renderEmailHtml(d), text: renderEmailText(d) };
  try {
    const r = provider === "smtp" ? await viaSmtp(msg) : provider === "brevo" ? await viaBrevo(msg) : await viaResend(msg);
    return r.error ? { at, to, error: redact(r.error) } : { at, to, id: r.id };
  } catch (e) {
    return { at, to, error: redact(`${provider}: ${(e as Error).message}`) };
  }
}
