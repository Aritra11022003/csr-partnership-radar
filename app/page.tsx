import Link from "next/link";
import { getLatestDigest } from "@/lib/run";
import { DigestView } from "./components/DigestView";
import { RunNowButton } from "./components/ClientBits";

export const dynamic = "force-dynamic";

export default async function Home() {
  const d = await getLatestDigest().catch(() => null);
  return (
    <>
      <div className="row spread" style={{ marginBottom: 8 }}>
        <span className="sub">Latest digest · next scheduled run Monday 07:00 IST</span>
        <RunNowButton />
      </div>
      {d ? (
        <DigestView d={d} />
      ) : (
        <div className="empty">
          <h1>No digest yet</h1>
          <p className="sub">Press “Run now” to pull the last 7 days of live CSR news and build this week’s digest, or wait for Monday 07:00 IST.</p>
          <p className="sub"><Link href="/how-it-works">How it works →</Link></p>
        </div>
      )}
    </>
  );
}
