/** Live fetch only: counts per source and per query. Which queries return nothing? */
import { loadEnv } from "./env";
loadEnv();
async function main() {
  const { seedAppConfig } = await import("../lib/config");
  const { fetchAllLive } = await import("../lib/sources/fetchers");
  const results = await fetchAllLive(seedAppConfig());
  for (const r of results) {
    console.log(`${r.status.ok ? "OK  " : "FAIL"} ${r.status.name.padEnd(22)} ${String(r.status.count).padStart(4)} items  ${r.status.ms}ms ${r.status.error ?? ""}`);
    for (const q of r.perQuery ?? []) console.log(`       ${String(q.count).padStart(3)}  ${q.q}${q.error ? `  !! ${q.error}` : ""}`);
  }
}
main();
