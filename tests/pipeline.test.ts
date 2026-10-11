import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execSync } from "node:child_process";
import { runPipeline } from "@/lib/run";
import { memoryStore, setStore } from "@/lib/store";
import { renderEmailHtml, renderEmailSubject } from "@/lib/email/render";
import { buildQueries } from "@/lib/sources/queries";
import { scoreItem } from "@/lib/pipeline/score";
import { ruleClassify } from "@/lib/pipeline/rules";
import { byFixture, config, fixtureArticles, NOW, oracleLlm } from "./helpers";
import fixtures from "@/seed/sample_articles.json";

beforeEach(() => setStore(memoryStore()));
afterEach(() => {
  setStore(null);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const demoRun = (extra: Partial<Parameters<typeof runPipeline>[0]> = {}) =>
  runPipeline({ trigger: "test", now: NOW, demo: true, offline: true, config: config(), classifyLlm: oracleLlm, digestLlm: null, log: () => {}, ...extra });

describe("DEMO_MODE end-to-end against fixture expectations", () => {
  it("fx-01, fx-02 → CALL; fx-03 → WATCH; fx-09 not CALL; fx-04 → Policy Watch", async () => {
    const { digest, scored } = await demoRun();
    const v = (id: string) => scored.find((s) => s.id === id);
    expect(v("fx-01")!.verdict).toBe("CALL");
    expect(v("fx-02")!.verdict).toBe("CALL");
    expect(v("fx-03")!.verdict).toBe("WATCH");
    expect(v("fx-09")!.verdict).not.toBe("CALL");
    expect(v("fx-10")!.cls.signal).toBe("NEW_INITIATIVE");
    expect(v("fx-10")!.verdict).toBe("WATCH");
    expect(digest.policy.map((p) => p.id)).toEqual(["fx-04"]);
    expect(digest.call.map((c) => c.id)).toEqual(expect.arrayContaining(["fx-01", "fx-02"]));
    // fx-06 merged, fx-08 dated out, fx-05/07/11 never surface
    const surfaced = [...digest.call, ...digest.watch, ...digest.policy].map((i) => i.id);
    for (const id of ["fx-05", "fx-06", "fx-07", "fx-08", "fx-11"]) expect(surfaced).not.toContain(id);
    expect(digest.skipped.some((s) => /older than 7 days/.test(s.reason))).toBe(true);
  });

  it("every surfaced item carries all required fields", async () => {
    const { digest } = await demoRun();
    for (const i of [...digest.call, ...digest.watch, ...digest.policy]) {
      expect(i.url).toMatch(/^https?:\/\//);
      for (const k of ["headline", "context", "why_now", "evidence", "publishedAt", "verdict", "signal"] as const) expect(i[k]).toBeTruthy();
      expect(i.demo).toBe(true);
    }
  });

  it("fixture expected fields: signal / sector / geo", async () => {
    const { scored } = await demoRun();
    for (const f of fixtures.articles) {
      const s = scored.find((x) => x.id === f.id);
      const e = f.expected as { signal?: string; sector?: string; geo?: string };
      if (!s || !e.signal) continue;
      expect(s.cls.signal, f.id).toBe(e.signal);
      if (e.sector) expect(s.sectorLabel?.toLowerCase().replace(/ /g, "_"), f.id).toBe(e.sector);
      if (e.geo) expect(s.geo?.id, f.id).toBe(e.geo);
    }
  });
});

describe("G23 demo data separation", () => {
  it("fixtures never appear when DEMO_MODE is off", async () => {
    const { digest } = await demoRun({ demo: false });
    expect(digest.demo).toBe(false);
    expect(digest.stats.fetched).toBe(0);
    expect([...digest.call, ...digest.watch, ...digest.policy]).toHaveLength(0);
  });
  it("demo digests are tagged DEMO in the email", async () => {
    const { digest } = await demoRun();
    expect(renderEmailSubject(digest)).toMatch(/^\[DEMO\]/);
    expect(renderEmailHtml(digest)).toMatch(/DEMO/);
  });
});

describe("G16 quiet week", () => {
  it("produces a short 'no strong signals' email with the scanned count, not an error", async () => {
    const { digest } = await demoRun({ demo: false });
    expect(digest.quiet).toBe(true);
    expect(renderEmailSubject(digest)).toMatch(/no strong signals/);
    expect(renderEmailHtml(digest)).toMatch(/No strong signals this week\. The radar scanned 0 articles/);
  });
});

describe("G19 idempotent email", () => {
  it("sends at most one email per ISO week", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "em_1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const c = config();
    c.org.recipients = ["ananya@example.org"];
    const a = await demoRun({ sendEmail: true, config: c });
    const b = await demoRun({ sendEmail: true, config: c });
    expect(a.digest.emailed?.id).toBe("em_1");
    expect(b.digest.emailed).toBeUndefined();
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes("resend"))).toHaveLength(1);
  });
  it("G20 only emails the NGO's own recipients, never companies", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "em_2" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const c = config();
    c.org.recipients = ["ananya@example.org"];
    await demoRun({ sendEmail: true, config: c });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.to).toEqual(["ananya@example.org"]);
  });
});

describe("settings drive the next run", () => {
  it("changing sectors changes the queries", () => {
    const c = config();
    const before = buildQueries(c).map((q) => q.q).join("\n");
    c.sectors = c.sectors.map((s) => (s.id === "digital_literacy" ? { ...s, enabled: false } : s));
    c.sectors.push({ id: "women_livelihoods", label: "Women Livelihoods", enabled: true, keywords: ["women entrepreneurs", "self-help groups"] });
    const after = buildQueries(c).map((q) => q.q).join("\n");
    expect(after).not.toMatch(/digital literacy/);
    expect(after).toMatch(/women entrepreneurs/);
    expect(after).not.toEqual(before);
  });
  it("changing geo priority changes the score", () => {
    const a = byFixture(fixtureArticles(), "fx-02"); // Maharashtra
    const c = config();
    const base = scoreItem(a, ruleClassify(a, c), c, { now: NOW }).score;
    c.geographies = c.geographies.map((g) => (g.id === "maharashtra" ? { ...g, tier: 1 } : g.id === "pune" ? { ...g, tier: 2 } : g));
    expect(scoreItem(a, ruleClassify(a, c), c, { now: NOW }).score).toBe(base + 6);
  });
  it("changing scoring weights changes verdicts", () => {
    const a = byFixture(fixtureArticles(), "fx-03");
    const c = config();
    const cls = { ...ruleClassify(a, c), confidence: 0.9 };
    expect(scoreItem(a, cls, c, { now: NOW }).verdict).toBe("WATCH");
    c.scoring.verdict_thresholds.CALL = 45;
    expect(scoreItem(a, cls, c, { now: NOW }).verdict).toBe("CALL");
  });
});

describe("G9 tool constraint", () => {
  it("no Anthropic SDK in package.json or source", () => {
    expect(execSync("node scripts/check-no-anthropic.mjs").toString()).toMatch(/^OK/);
  });
});
