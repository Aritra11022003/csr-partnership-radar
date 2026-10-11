import { isAdmin, isCron, unauthorized } from "@/lib/auth";
import { GUEST_LIMITS, isGuest, takeGuestQuota } from "@/lib/guest";
import { runPipeline } from "@/lib/run";
import { getStore, KEYS } from "@/lib/store";
import { isoWeekKey } from "@/lib/util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // G18

/**
 * GET  — Vercel Cron (Mon 01:30 UTC = 07:00 IST), Authorization: Bearer CRON_SECRET. Runs once per ISO week (G19).
 * POST — manual "Run now" from the dashboard, x-admin-token: ADMIN_TOKEN. Body: { sendEmail?, forceEmail?, sample? }.
 *        sample=true builds a separate DEMO digest from the fixtures (no email, never replaces the real week).
 */
export async function GET(req: Request) {
  if (!isCron(req) && !isAdmin(req)) return unauthorized();
  const week = isoWeekKey();
  const cron = isCron(req);
  // G19: a run key by ISO week prevents duplicate work/emails if cron fires twice.
  if (cron && !(await getStore().setNX(KEYS.runLock(week), { at: new Date().toISOString() }, 8 * 24 * 3600))) {
    return Response.json({ ok: true, skipped: true, reason: `already ran for ${week}` });
  }
  try {
    const { digest } = await runPipeline({ trigger: "cron", sendEmail: true });
    return Response.json({ ok: true, id: digest.id, call: digest.call.length, watch: digest.watch.length, policy: digest.policy.length, emailed: digest.emailed ?? null });
  } catch (e) {
    if (cron) await getStore().del(KEYS.runLock(week)); // allow a retry
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const admin = isAdmin(req);
  // Guests (no token at all) may run without email, a few times a day. A wrong token is still 401 (G8).
  if (!admin && !isGuest(req)) return unauthorized();
  const body = (await req.json().catch(() => ({}))) as { sendEmail?: boolean; forceEmail?: boolean; sample?: boolean };
  if (!admin) {
    const left = await takeGuestQuota("run");
    if (left < 0) return Response.json({ ok: false, error: `Guest limit reached (${GUEST_LIMITS.run} runs per day). Try tomorrow or use the admin token.` }, { status: 429 });
    body.sendEmail = false;
    body.forceEmail = false;
  }
  try {
    const { digest } = await runPipeline({ trigger: "manual", sendEmail: !!body.sendEmail, forceEmail: !!body.forceEmail, sample: !!body.sample });
    return Response.json({ ok: true, id: digest.id, call: digest.call.length, watch: digest.watch.length, policy: digest.policy.length, emailed: digest.emailed ?? null, warnings: digest.warnings });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
