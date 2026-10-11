// G9: the app calls ONLY Gemini. Fail CI if any Anthropic/Claude SDK or endpoint sneaks in.
import fs from "node:fs";
import path from "node:path";
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
const bad = deps.filter((d) => /anthropic|claude/i.test(d));
const hits = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".next", ".git", "out", ".data"].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(ts|tsx|js|mjs)$/.test(e.name) && !p.includes("check-no-anthropic")) {
      const s = fs.readFileSync(p, "utf8");
      if (/@anthropic-ai|api\.anthropic\.com|from ["']anthropic/.test(s)) hits.push(p);
    }
  }
};
walk(".");
if (bad.length || hits.length) {
  console.error("Anthropic SDK/API usage found:", bad, hits);
  process.exit(1);
}
console.log(`OK: no Anthropic SDK in ${deps.length} dependencies or source files. AI provider = @google/genai only.`);
