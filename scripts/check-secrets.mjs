// G7: after `next build`, make sure no secret value from the environment ended up in client/static output.
import fs from "node:fs";
import path from "node:path";
const names = ["GEMINI_API_KEY", "RESEND_API_KEY", "DATABASE_URL", "CRON_SECRET", "ADMIN_TOKEN", "NEWSAPI_KEY"];
const secrets = names.map((n) => [n, process.env[n]]).filter(([, v]) => v && v.length >= 8);
const roots = [".next/static", ".next/server/app"].filter((p) => fs.existsSync(p));
let hits = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(js|html|json|rsc|txt|map)$/.test(e.name)) {
      const s = fs.readFileSync(p, "utf8");
      for (const [n, v] of secrets) if (s.includes(v)) hits.push(`${n} in ${p}`);
    }
  }
};
roots.forEach(walk);
if (hits.length) {
  console.error("Secret values found in build output:\n" + hits.join("\n"));
  process.exit(1);
}
console.log(`OK: checked ${secrets.length} secret(s) against ${roots.join(", ") || "(no build output)"} — none leaked.`);
