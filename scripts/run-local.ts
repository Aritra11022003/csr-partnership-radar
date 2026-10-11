/**
 * Run the full pipeline locally and write out/digest.json + out/email.html for preview.
 *   npm run run:local                # live sources
 *   npm run run:local -- --demo      # live + DEMO fixtures
 *   npm run run:local -- --offline --demo   # fixtures only
 *   npm run run:local -- --email     # also send via Resend
 */
import fs from "node:fs";
import path from "node:path";
import { loadEnv } from "./env";
loadEnv();

async function main() {
  const { runPipeline } = await import("../lib/run");
  const { renderEmailHtml } = await import("../lib/email/render");
  const args = new Set(process.argv.slice(2));
  const { digest, scored, perQuery } = await runPipeline({
    trigger: "script",
    demo: args.has("--demo") ? true : undefined,
    offline: args.has("--offline"),
    sendEmail: args.has("--email"),
    forceEmail: args.has("--force-email"),
    persist: !args.has("--no-persist"),
  });
  fs.mkdirSync("out", { recursive: true });
  fs.writeFileSync("out/digest.json", JSON.stringify(digest, null, 2));
  fs.writeFileSync("out/email.html", renderEmailHtml(digest));
  fs.writeFileSync(
    "out/scored.json",
    JSON.stringify(
      scored.map((s) => ({ id: s.id, title: s.article.title, source: s.article.source, signal: s.cls.signal, by: s.cls.classifiedBy, company: s.cls.company, sector: s.sectorLabel, geo: s.geo?.label, conf: s.cls.confidence, verified: s.verified, score: s.score, verdict: s.verdict, section: s.section, evidence: s.cls.evidence, reasons: s.verdictReasons })),
      null,
      2,
    ),
  );
  if (perQuery) {
    console.log("\nGoogle News per query:");
    for (const q of perQuery) console.log(`  ${String(q.count).padStart(3)}  ${q.q}${q.error ? `  !! ${q.error}` : ""}`);
  }
  console.log(`\nWarnings:\n  ${digest.warnings.join("\n  ") || "(none)"}`);
  console.log(`\nCALL:`);
  for (const i of digest.call) console.log(`  [${i.score}] ${i.headline}  — ${i.source}`);
  console.log(`WATCH:`);
  for (const i of digest.watch) console.log(`  [${i.score}] ${i.headline}  — ${i.source}`);
  console.log(`POLICY:`);
  for (const i of digest.policy) console.log(`  ${i.headline}  — ${i.source}`);
  console.log(`\nSummary: ${digest.week_summary}\nWrote ${path.resolve("out/email.html")}`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
