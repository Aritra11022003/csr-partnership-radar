import Link from "next/link";
import { getLatestDigest } from "@/lib/run";
import { DigestView } from "./components/DigestView";
import { RunNowButton } from "./components/ClientBits";

export const dynamic = "force-dynamic";

export default async function Home() {
  const d = await getLatestDigest().catch(() => null);
  if (d) return <DigestView d={d} showRun />;
  return (
    <section className="hero" style={{ minHeight: 420 }}>
      <div className="wrap" style={{ textAlign: "center", paddingTop: 30 }}>
        <div className="eyebrow">CSR Partnership Radar</div>
        <h1 className="display">Your first digest is one click away</h1>
        <p className="summary-hero" style={{ margin: "14px auto 22px" }}>
          Every Monday at 07:00 IST the radar reads the last 7 days of live Indian news, picks out companies seeking NGO partners,
          launching education or skilling CSR, or raising CSR budgets, and decides what’s worth a call.
        </p>
        <RunNowButton hero />
        <p className="sub" style={{ marginTop: 18 }}><Link href="/how-it-works" style={{ color: "var(--hero-muted)" }}>How it works →</Link></p>
      </div>
    </section>
  );
}
