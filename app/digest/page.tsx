import Link from "next/link";
import { getDigest, listDigests } from "@/lib/run";
import { fmtDate } from "@/lib/email/render";

export const dynamic = "force-dynamic";

export default async function Archive() {
  const ids = await listDigests().catch(() => []);
  const digests = (await Promise.all(ids.slice(0, 52).map((id) => getDigest(id).catch(() => null)))).filter(Boolean);
  return (
    <>
      <h1>Past digests</h1>
      <p className="sub">One per run date. Each digest is stored with its items, sources, skipped list and run notes.</p>
      {digests.length === 0 ? (
        <div className="empty">No digests yet.</div>
      ) : (
        <div className="panel scroll">
          <table>
            <thead><tr><th>Week of</th><th>Call</th><th>Watch</th><th>Policy</th><th>Scanned</th><th>Top item</th></tr></thead>
            <tbody>
              {digests.map((d) => (
                <tr key={d!.id}>
                  <td><Link href={`/digest/${d!.id}`}>{fmtDate(d!.generatedAt)}</Link> <span className="muted">{d!.week}</span>{d!.demo && <span className="chip warn" style={{ marginLeft: 6 }}>DEMO</span>}</td>
                  <td className="ok">{d!.call.length}</td>
                  <td>{d!.watch.length}</td>
                  <td>{d!.policy.length}</td>
                  <td>{d!.stats.fetched}</td>
                  <td className="muted">{(d!.call[0] ?? d!.watch[0])?.headline ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
