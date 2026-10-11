import { describe, expect, it, vi } from "vitest";
import { checkText, corpusFor, templateText, toDigestFacts, writeDigest } from "@/lib/pipeline/digest";
import { classifyAll } from "@/lib/pipeline/classify";
import { scoreItem } from "@/lib/pipeline/score";
import { byFixture, config, fixtureArticles, NOW, oracleLlm } from "./helpers";

async function scoredFixtures(ids: string[]) {
  const arts = fixtureArticles().filter((a) => ids.includes(a.fixtureId!));
  const { classifications } = await classifyAll(arts, config(), oracleLlm);
  return classifications.map((c) => scoreItem(arts.find((a) => a.id === c.id)!, c, config(), { now: NOW }));
}

const goodWriter = (items: { id: string }[]) =>
  vi.fn().mockResolvedValue(
    JSON.stringify({
      week_summary: "2 items worth a call this week. Most urgent: Vardhan Auto Components is seeking implementation partners.",
      items: items.map((i) => ({
        id: i.id,
        headline: i.id === "fx-01" ? "Vardhan Auto Components seeks NGO partners for Pune skilling" : "Kalpataru Fintech launches digital literacy drive",
        context: i.id === "fx-01" ? "Vardhan Auto Components is seeking implementation partners for a ₹6 crore programme to train 3,000 school dropouts in Chakan and Pimpri." : "Kalpataru Fintech announced digital literacy training for 10,000 first-generation college students across Maharashtra.",
        why_now: "Partners are not yet chosen.",
        suggested_angle: "Lead with our work with school dropouts in Pune.",
      })),
      policy_notes: [],
    }),
  );

describe("G1 no fabricated facts in the digest", () => {
  it("accepts a writer that only rephrases given facts", async () => {
    const items = await scoredFixtures(["fx-01", "fx-02"]);
    const w = await writeDigest(items, config(), goodWriter(items));
    expect(w.writer).toBe("gemini");
    expect(w.warnings).toEqual([]);
    expect(w.texts.get("fx-01")!.headline).toMatch(/^Vardhan/);
  });

  it("rejects a digest with an injected fake company and falls back to the template", async () => {
    const items = await scoredFixtures(["fx-01"]);
    const writer = vi.fn().mockResolvedValue(
      JSON.stringify({
        week_summary: "1 item worth a call this week.",
        items: [{ id: "fx-01", headline: "Vardhan Auto Components seeks NGO partners", context: "Vardhan is co-funding this with Zenith Motors Foundation, which has also pledged support.", why_now: "Deadline soon.", suggested_angle: "Pitch our work." }],
        policy_notes: [],
      }),
    );
    const w = await writeDigest(items, config(), writer);
    expect(w.warnings.join(" ")).toMatch(/output check rejected writer text for fx-01.*Zenith/);
    expect(w.texts.get("fx-01")).toEqual(templateText(toDigestFacts(items[0]), config()));
    expect(w.texts.get("fx-01")!.context).not.toMatch(/Zenith/);
  });

  it("rejects invented contacts, URLs, unstated amounts and numbers (G3, G21)", async () => {
    const [item] = await scoredFixtures(["fx-12"]); // amount is null
    const facts = toDigestFacts(item);
    const corpus = corpusFor(facts, config());
    const opts = { amountKnown: false, company: "Deccan Logistics" };
    expect(checkText(["Email csr@deccan.com to apply."], corpus, opts)).toContain("contains an email address");
    expect(checkText(["Call 9876543210 today."], corpus, opts)).toContain("contains a phone number");
    expect(checkText(["See https://deccan.example for details."], corpus, opts)).toContain("contains a URL");
    expect(checkText(["Deccan Logistics will spend ₹12 crore on ITIs."], corpus, opts)).toContain("mentions an amount that was not stated");
    expect(checkText(["The programme will reach 4,500 trainees."], corpus, opts).join()).toMatch(/number "4,500"/);
    expect(checkText(["Deccan Logistics will support ITI upgrades in Nashik."], corpus, { ...opts, headline: "Deccan Logistics backs ITI upgrades", company: "Deccan Logistics" })).toEqual([]);
  });

  it("falls back fully to the template when the writer returns garbage twice", async () => {
    const items = await scoredFixtures(["fx-01", "fx-04"]);
    const writer = vi.fn().mockResolvedValue("nope");
    const w = await writeDigest(items, config(), writer);
    expect(writer).toHaveBeenCalledTimes(2);
    expect(w.writer).toBe("template");
    expect(w.texts.size).toBe(2);
    expect(w.policyNotes.get("fx-04")).toBeTruthy();
  });

  it("week summary says plainly when there are zero CALL items", async () => {
    const items = (await scoredFixtures(["fx-03"])).filter((s) => s.section !== "CALL");
    const w = await writeDigest(items, config(), null);
    expect(w.week_summary).toMatch(/^No items reached CALL/);
  });
});

describe("digest writer cannot change verdicts or facts", () => {
  it("facts are owned by code (verdict, score, url, company come from scoring, not the LLM)", async () => {
    const items = await scoredFixtures(["fx-01"]);
    const f = toDigestFacts(items[0]);
    expect(f.url).toBe(byFixture(fixtureArticles(), "fx-01").url);
    expect(f.verdict).toBe("CALL");
  });
});
