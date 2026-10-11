import { isAdmin, unauthorized } from "@/lib/auth";
import { loadConfig, saveConfig } from "@/lib/config";
import { buildQueries } from "@/lib/sources/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { config, source } = await loadConfig();
  return Response.json({ config, source, queries: buildQueries(config).map((q) => q.q) });
}

/** G8: saving settings requires ADMIN_TOKEN. Validated with zod before it is stored. */
export async function PUT(req: Request) {
  if (!isAdmin(req)) return unauthorized();
  const body = await req.json().catch(() => null);
  const r = await saveConfig(body);
  if (!r.ok) return Response.json({ error: r.error }, { status: 400 });
  return Response.json({ ok: true, queries: buildQueries(r.config).map((q) => q.q) });
}
