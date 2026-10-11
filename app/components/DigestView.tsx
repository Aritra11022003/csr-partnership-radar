import type { Digest } from "@/lib/types";
import { feedbackSig } from "@/lib/email/render";
import { DigestBoard } from "./DigestBoard";

/** Server wrapper: signs feedback links (secret stays on the server), then hands off to the interactive board. */
export function DigestView({ d, showRun = false }: { d: Digest; showRun?: boolean }) {
  const sigs: Record<string, Record<"up" | "down" | "called", string>> = {};
  for (const i of [...d.call, ...d.watch, ...d.policy]) {
    sigs[i.id] = { up: feedbackSig(d.id, i.id, "up"), down: feedbackSig(d.id, i.id, "down"), called: feedbackSig(d.id, i.id, "called") };
  }
  return <DigestBoard d={d} sigs={sigs} showRun={showRun} />;
}
