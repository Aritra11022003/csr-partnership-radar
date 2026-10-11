import { getDigest, getLatestDigest, listDigests } from "@/lib/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    const d = await getDigest(id);
    return d ? Response.json(d) : Response.json({ error: "not found" }, { status: 404 });
  }
  return Response.json({ latest: (await getLatestDigest())?.id ?? null, ids: await listDigests() });
}
