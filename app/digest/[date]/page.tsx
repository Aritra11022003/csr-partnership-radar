import Link from "next/link";
import { notFound } from "next/navigation";
import { getDigest } from "@/lib/run";
import { DigestView } from "../../components/DigestView";

export const dynamic = "force-dynamic";

export default async function DigestPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();
  const d = await getDigest(date);
  if (!d) notFound();
  return (
    <>
      <div className="wrap" style={{ paddingTop: 14 }}><Link href="/digest" className="sub">← All digests</Link></div>
      <DigestView d={d} />
    </>
  );
}
