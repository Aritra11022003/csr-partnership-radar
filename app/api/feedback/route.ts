import { feedbackSig } from "@/lib/email/render";
import { getDigest } from "@/lib/run";
import { getStore, KEYS } from "@/lib/store";
import type { Feedback, FeedbackKind } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LABEL: Record<FeedbackKind, string> = { up: "👍 Marked useful", down: "👎 Marked not useful", called: "📞 Marked as called" };

async function record(digestId: string, itemId: string, kind: FeedbackKind) {
  const d = await getDigest(digestId);
  const item = d ? [...d.call, ...d.watch, ...d.policy].find((i) => i.id === itemId) : undefined;
  const fb: Feedback = { itemId, digestId, kind, company: item?.company ?? null, signal: item?.signal ?? null, at: new Date().toISOString() };
  await getStore().lpush(KEYS.feedback, fb, 1000);
  await getStore().set(`feedback:item:${digestId}:${itemId}`, kind);
  return item;
}

/** Email links: signed with HMAC so feedback can't be forged by guessing ids. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const d = u.searchParams.get("d") ?? "";
  const i = u.searchParams.get("i") ?? "";
  const k = u.searchParams.get("k") as FeedbackKind;
  const s = u.searchParams.get("s") ?? "";
  if (!["up", "down", "called"].includes(k) || !d || !i || s !== feedbackSig(d, i, k)) {
    return new Response("Invalid feedback link.", { status: 400 });
  }
  const item = await record(d, i, k);
  const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Thanks</title>
<body style="font-family:system-ui;background:#f4f6f9;display:grid;place-items:center;min-height:100vh;margin:0">
<div style="background:#fff;padding:28px 32px;border-radius:12px;border:1px solid #e3e7ee;max-width:420px">
<div style="font-size:22px;font-weight:700;margin-bottom:6px">${LABEL[k]}</div>
<div style="color:#5b6577">${item ? item.headline.replace(/[<>&]/g, "") : "Item"} — thanks, this tunes next week's ranking.</div>
<p><a href="/digest/${encodeURIComponent(d)}">Back to the digest →</a></p></div></body>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

/** Dashboard buttons (same-origin). */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { d?: string; i?: string; k?: FeedbackKind; s?: string };
  if (!body.d || !body.i || !body.k || !["up", "down", "called"].includes(body.k) || body.s !== feedbackSig(body.d, body.i, body.k)) {
    return Response.json({ error: "invalid" }, { status: 400 });
  }
  await record(body.d, body.i, body.k);
  return Response.json({ ok: true });
}
