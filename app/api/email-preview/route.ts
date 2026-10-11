import { renderEmailHtml } from "@/lib/email/render";
import { getDigest, getLatestDigest } from "@/lib/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Renders the exact HTML email for a stored digest (same template Resend sends). */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  const d = id ? await getDigest(id) : await getLatestDigest();
  if (!d) return new Response("No digest yet.", { status: 404 });
  return new Response(renderEmailHtml(d), { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
