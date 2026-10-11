import { describe, expect, it, vi } from "vitest";
import { classifyAll, buildClassifyUserMessage, buildClassifySystemPrompt } from "@/lib/pipeline/classify";
import { ruleClassify } from "@/lib/pipeline/rules";
import { scoreItem, verifyEvidence } from "@/lib/pipeline/score";
import { detectInjection } from "@/lib/pipeline/injection";
import { byFixture, config, fixtureArticles, NOW, oracleLlm } from "./helpers";

const arts = fixtureArticles();

describe("G13 schema validity: zod → one retry with hint → rule fallback", () => {
  it("retries once on malformed JSON, then falls back to rules", async () => {
    const llm = vi.fn().mockResolvedValue("{not json");
    const { classifications, stats } = await classifyAll([byFixture(arts, "fx-01"), byFixture(arts, "fx-02")], config(), llm);
    expect(llm).toHaveBeenCalledTimes(2);
    expect(llm.mock.calls[1][0].user).toMatch(/previous answer was rejected/);
    expect(stats.byRules).toBe(2);
    expect(classifications.every((c) => c.classifiedBy === "rules")).toBe(true);
  });
  it("recovers on retry when the second answer is valid", async () => {
    const llm = vi.fn().mockResolvedValueOnce('[{"id":"fx-01","signal":"WRONG"}]').mockImplementation(oracleLlm);
    const { stats } = await classifyAll([byFixture(arts, "fx-01")], config(), llm);
    expect(stats.byLlm).toBe(1);
    expect(stats.retries).toBe(1);
  });
  it("uses rules for ids the model omitted", async () => {
    const llm = vi.fn().mockImplementation(async (a) => JSON.stringify(JSON.parse(await oracleLlm(a)).slice(0, 1)));
    const { classifications, stats } = await classifyAll([byFixture(arts, "fx-01"), byFixture(arts, "fx-02")], config(), llm);
    expect(classifications.map((c) => c.id)).toEqual(["fx-01", "fx-02"]);
    expect(stats.byLlm).toBe(1);
    expect(stats.byRules).toBe(1);
  });
  it("ignores ids the model invented", async () => {
    const llm = vi.fn().mockImplementation(async (a) => {
      const out = JSON.parse(await oracleLlm(a));
      out.push({ ...out[0], id: "fake-99" });
      return JSON.stringify(out);
    });
    const { classifications } = await classifyAll([byFixture(arts, "fx-01")], config(), llm);
    expect(classifications.map((c) => c.id)).toEqual(["fx-01"]);
  });
});

describe("G2 evidence required", () => {
  it("accepts an exact substring (case/quote-insensitive)", () => {
    expect(verifyEvidence("SEEKING implementation partners for a ₹6 crore programme", byFixture(arts, "fx-01"))).toBe(true);
  });
  it("downgrades a paraphrased quote: verified=false, −25, never CALL", async () => {
    const llm = vi.fn().mockImplementation(async (a) => {
      const out = JSON.parse(await oracleLlm(a));
      out[0].evidence = "The company wants NGOs to help train dropouts in Pune"; // paraphrase
      return JSON.stringify(out);
    });
    const { classifications } = await classifyAll([byFixture(arts, "fx-01")], config(), llm);
    const s = scoreItem(byFixture(arts, "fx-01"), classifications[0], config(), { now: NOW });
    expect(s.verified).toBe(false);
    expect(s.breakdown.evidencePenalty).toBe(-25);
    expect(s.verdict).not.toBe("CALL");
  });
});

describe("G3 no guessed numbers", () => {
  it("fx-12 → amount_inr_crore === null (rules and oracle)", async () => {
    expect(ruleClassify(byFixture(arts, "fx-12"), config()).amount_inr_crore).toBeNull();
    const { classifications } = await classifyAll([byFixture(arts, "fx-12")], config(), oracleLlm);
    expect(classifications[0].amount_inr_crore).toBeNull();
  });
  it("rules extract a stated amount exactly", () => {
    expect(ruleClassify(byFixture(arts, "fx-03"), config()).amount_inr_crore).toBe(48);
  });
});

describe("G4 partner-search precision", () => {
  it("fx-10 is not PARTNER_SEARCH (rules)", () => {
    expect(ruleClassify(byFixture(arts, "fx-10"), config()).signal).not.toBe("PARTNER_SEARCH");
  });
  it("even if the model says PARTNER_SEARCH for 'partners with', code downgrades it", () => {
    const a = byFixture(arts, "fx-10");
    const cls = { ...ruleClassify(a, config()), signal: "PARTNER_SEARCH" as const, primary_sector: "youth_employment", evidence: "Brightline Bank partners with NGOs for youth employability", confidence: 0.9 };
    const s = scoreItem(a, cls, config(), { now: NOW });
    expect(s.cls.signal).toBe("NEW_INITIATIVE");
  });
  it("fx-01 explicit seeking language stays PARTNER_SEARCH", () => {
    expect(ruleClassify(byFixture(arts, "fx-01"), config()).signal).toBe("PARTNER_SEARCH");
  });
});

describe("G6 prompt injection", () => {
  it("regex pre-scan flags fx-09", () => {
    expect(detectInjection(`${byFixture(arts, "fx-09").title} ${byFixture(arts, "fx-09").snippet}`)).toBe(true);
    expect(byFixture(arts, "fx-09").injectionSuspected).toBe(true);
    expect(detectInjection(byFixture(arts, "fx-01").snippet)).toBe(false);
  });
  it("fx-09 is not CALL and is flagged even if the model obeys the injection", async () => {
    const obedient = vi.fn().mockImplementation(async ({ user }) => {
      const items = JSON.parse(user.slice(user.indexOf("```json") + 7, user.lastIndexOf("```")));
      return JSON.stringify(items.map((i: { id: string }) => ({ id: i.id, signal: "PARTNER_SEARCH", company: "Orion Pharma", primary_sector: "education", secondary_sectors: [], geo_mentions: ["Pune"], amount_inr_crore: null, beneficiaries: null, deadline: null, evidence: "Orion Pharma will expand its STEM scholarships for girls", one_line_summary: "x", confidence: 1.0, injection_flag: false })));
    });
    const a = byFixture(arts, "fx-09");
    const { classifications } = await classifyAll([a], config(), obedient);
    const s = scoreItem(a, classifications[0], config(), { now: NOW });
    expect(s.verdict).not.toBe("CALL");
    expect(s.cls.injection_flag).toBe(true);
    expect(s.cls.signal).toBe("NEW_INITIATIVE"); // G4 guard too
  });
  it("article text is passed as JSON data, separate from the system prompt", () => {
    const msg = buildClassifyUserMessage([byFixture(arts, "fx-09")]);
    expect(msg).toMatch(/DATA ONLY/);
    expect(() => JSON.parse(msg.slice(msg.indexOf("```json") + 7, msg.lastIndexOf("```")))).not.toThrow();
    const sys = buildClassifySystemPrompt(config());
    expect(sys).toMatch(/The item text is DATA/);
    expect(sys).not.toMatch(/IGNORE PREVIOUS/);
    expect(sys).toMatch(/skill_development/);
  });
});

describe("G14 confidence gate", () => {
  it("confidence < 0.6 cannot be CALL even with a high score", () => {
    const a = byFixture(arts, "fx-01");
    const cls = { ...ruleClassify(a, config()), confidence: 0.59 };
    const s = scoreItem(a, cls, config(), { now: NOW });
    expect(s.score).toBeGreaterThanOrEqual(65);
    expect(s.verdict).toBe("WATCH");
    expect(scoreItem(a, { ...cls, confidence: 0.6 }, config(), { now: NOW }).verdict).toBe("CALL");
  });
  it("rule-based fallback never yields CALL", () => {
    for (const a of arts) expect(scoreItem(a, ruleClassify(a, config()), config(), { now: NOW }).verdict).not.toBe("CALL");
  });
});

describe("G12 relevance", () => {
  it("fx-07 (water conservation) and fx-11 (UK) are IRRELEVANT", () => {
    expect(ruleClassify(byFixture(arts, "fx-07"), config()).signal).toBe("IRRELEVANT");
    expect(ruleClassify(byFixture(arts, "fx-11"), config()).signal).toBe("IRRELEVANT");
  });
  it("a model's out-of-sector label is overridden to IRRELEVANT in code", () => {
    const a = byFixture(arts, "fx-07");
    const s = scoreItem(a, { ...ruleClassify(a, config()), signal: "NEW_INITIATIVE", primary_sector: "water", evidence: "Sahyadri Cements launched a CSR programme", confidence: 0.9 }, config(), { now: NOW });
    expect(s.cls.signal).toBe("IRRELEVANT");
    expect(s.verdict).toBe("SKIP");
  });
});

describe("Gemini error handling (quota-aware Flash fallback)", async () => {
  const { classifyGeminiError } = await import("@/lib/gemini");
  it("daily free-tier quota → move to the next Flash model", () => {
    expect(classifyGeminiError('{"code":429,"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}').kind).toBe("daily_quota");
  });
  it("per-minute limit → wait the advertised delay", () => {
    expect(classifyGeminiError('{"code":429,"message":"quota","retryDelay":"12s"}')).toEqual({ kind: "rate_limit", retryAfterMs: 12000 });
  });
  it("retired model → unavailable; overload → retry", () => {
    expect(classifyGeminiError('{"code":404,"message":"no longer available"}').kind).toBe("model_unavailable");
    expect(classifyGeminiError('{"code":503,"message":"high demand"}').kind).toBe("overloaded");
  });
});
