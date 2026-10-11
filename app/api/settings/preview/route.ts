import { ConfigSchema } from "@/lib/config";
import { buildQueries } from "@/lib/sources/queries";
import type { AppConfig } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public, read-only: validate a proposed config and show the search queries it WOULD produce. Nothing is saved. */
export async function POST(req: Request) {
  const parsed = ConfigSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return Response.json({ ok: false, error: `${i.path.join(".")}: ${i.message}` }, { status: 400 });
  }
  return Response.json({ ok: true, queries: buildQueries(parsed.data as AppConfig).map((q) => q.q) });
}
