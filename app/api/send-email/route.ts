import { isAdmin, unauthorized } from "@/lib/auth";
import { GUEST_LIMITS, isGuest, takeGuestQuota } from "@/lib/guest";
import { loadConfig } from "@/lib/config";
import { sendDigestEmail } from "@/lib/email/send";
import { getDigest, getLatestDigest } from "@/lib/run";
import { getStore, KEYS } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Admin-only: (re)send an already-built digest by email. No pipeline re-run, no Gemini quota.
 * Body: { id?: string (default latest), to?: string[] (default configured recipients, max 10) }.
 * Still only ever sends to addresses the admin chose — never to companies (G20).
 */
export async function POST(req: Request) {
  const admin = isAdmin(req);
  if (!admin && !isGuest(req)) return unauthorized();
  const body = (await req.json().catch(() => ({}))) as { id?: string; to?: string[] };
  if (!admin && (body.to ?? []).filter((x) => String(x).trim()).length !== 1) {
    return Response.json({ ok: false, error: "As a guest, enter exactly one email address." }, { status: 400 });
  }
  const d = body.id ? await getDigest(body.id) : await getLatestDigest();
  if (!d) return Response.json({ ok: false, error: "digest not found" }, { status: 404 });
  const { config } = await loadConfig();
  const requested = (body.to ?? []).map((s) => String(s).trim()).filter(Boolean);
  const bad = requested.filter((e) => !EMAIL.test(e));
  if (bad.length) return Response.json({ ok: false, error: `invalid email: ${bad.join(", ")}` }, { status: 400 });
  const to = (requested.length ? requested : config.org.recipients).slice(0, 10);
  if (!admin && (await takeGuestQuota("email")) < 0) {
    return Response.json({ ok: false, error: `Guest limit reached (${GUEST_LIMITS.email} emails per day).` }, { status: 429 });
  }
  if (!to.length) return Response.json({ ok: false, error: "no recipients" }, { status: 400 });
  const emailed = await sendDigestEmail(d, { ...config, org: { ...config.org, recipients: to } });
  if (!emailed.error) {
    d.emailed = emailed;
    await getStore().set(KEYS.digest(d.id), d);
  }
  return Response.json({ ok: !emailed.error, emailed }, { status: emailed.error ? 502 : 200 });
}
