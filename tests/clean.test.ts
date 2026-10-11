import { describe, expect, it } from "vitest";
import { dedupe, filterByDate, normalize, prefilter } from "@/lib/pipeline/clean";
import { canonicalUrl, isoWeekKey } from "@/lib/util";
import { byFixture, config, fixtureArticles, NOW } from "./helpers";

describe("G5 every item has a source URL", () => {
  it("drops items without a valid http(s) URL before anything else", () => {
    const { articles, dropped } = normalize([
      { title: "No url", url: "", sourceName: "t", publishedAt: NOW.toISOString() },
      { title: "Bad scheme", url: "javascript:alert(1)", sourceName: "t", publishedAt: NOW.toISOString() },
      { title: "ftp", url: "ftp://x.org/a", sourceName: "t", publishedAt: NOW.toISOString() },
      { title: "Good", url: "https://economictimes.indiatimes.com/a", sourceName: "t", publishedAt: NOW.toISOString() },
    ]);
    expect(articles.map((a) => a.title)).toEqual(["Good"]);
    expect(dropped.every((d) => d.reason === "no valid source URL")).toBe(true);
  });
});

describe("G10 7-day window (IST)", () => {
  it("drops fx-08 (19 days old) and keeps the rest", () => {
    const { kept, dropped } = filterByDate(fixtureArticles(), 7, NOW);
    expect(kept.some((a) => a.fixtureId === "fx-08")).toBe(false);
    expect(dropped.some((d) => d.title.startsWith("Old news"))).toBe(true);
    expect(kept).toHaveLength(11);
  });
  it("uses IST calendar days at the boundary", () => {
    // 7 IST days before Mon 12 Oct 07:00 IST is Mon 5 Oct — kept; Sun 4 Oct 23:59 IST is 8 days — dropped.
    const mk = (iso: string) => normalize([{ title: "x", url: "https://a.in/x", sourceName: "t", publishedAt: iso }]).articles;
    expect(filterByDate(mk("2026-10-04T18:31:00Z"), 7, NOW).kept).toHaveLength(1); // 5 Oct 00:01 IST
    expect(filterByDate(mk("2026-10-04T18:29:00Z"), 7, NOW).kept).toHaveLength(0); // 4 Oct 23:59 IST
  });
});

describe("G11 dedupe", () => {
  it("merges fx-06 into fx-01 with both sources listed", () => {
    const arts = filterByDate(fixtureArticles(), 7, NOW).kept;
    const { kept, mergedIds } = dedupe(arts, config());
    expect(kept.some((a) => a.fixtureId === "fx-06")).toBe(false);
    expect(mergedIds).toContainEqual({ id: "fx-06", into: "fx-01" });
    const fx1 = byFixture(kept, "fx-01");
    expect(fx1.alsoReportedBy.map((x) => x.source)).toContain("another-news.test");
  });
  it("merges by canonical URL (tracking params, www, trailing slash)", () => {
    expect(canonicalUrl("https://www.Example.com/a/b/?utm_source=x&id=2#top")).toBe(canonicalUrl("https://example.com/a/b?id=2"));
    const { articles } = normalize([
      { title: "A story", url: "https://www.livemint.com/x/?utm_campaign=1", sourceName: "g", publishedAt: NOW.toISOString() },
      { title: "A different headline entirely", url: "https://livemint.com/x", sourceName: "gdelt", publishedAt: NOW.toISOString() },
    ]);
    expect(dedupe(articles).kept).toHaveLength(1);
  });
  it("does not merge unrelated stories", () => {
    const arts = filterByDate(fixtureArticles(), 7, NOW).kept;
    expect(dedupe(arts, config()).kept).toHaveLength(10);
  });
});

describe("G12 / pre-filter", () => {
  it("drops non-CSR market news (fx-05), non-focus CSR (fx-07) and non-India (fx-11) before the LLM", () => {
    const arts = dedupe(filterByDate(fixtureArticles(), 7, NOW).kept, config()).kept;
    const { kept } = prefilter(arts, config());
    const ids = kept.map((a) => a.fixtureId);
    expect(ids).not.toContain("fx-05");
    expect(ids).not.toContain("fx-07");
    expect(ids).not.toContain("fx-11");
    expect(ids).toEqual(expect.arrayContaining(["fx-01", "fx-02", "fx-03", "fx-04", "fx-09", "fx-10", "fx-12"]));
  });
  it("drops obviously foreign items deterministically", () => {
    const { articles } = normalize([
      { title: "Missouri schools foundation announces $2 million scholarship for STEM education", snippet: "CSR", url: "https://k.com/a", sourceName: "g", publishedAt: NOW.toISOString() },
    ]);
    const r = prefilter(articles, config());
    expect(r.kept).toHaveLength(0);
    expect(r.dropped[0].reason).toMatch(/not India/);
  });
});

describe("G17 cost cap", () => {
  it("sends at most 120 items to the LLM, keeping the highest pre-filter scores", () => {
    const c = config();
    c.limits.max_items_to_llm = 500 as number; // even a bad setting can't exceed 120
    const raw = Array.from({ length: 200 }, (_, i) => ({
      title: `Company${i} CSR launches skilling programme ${i % 2 ? "in Pune" : "for youth"} number ${i}`,
      url: `https://x${i}.in/a`,
      sourceName: "t",
      publishedAt: NOW.toISOString(),
    }));
    const { kept } = prefilter(normalize(raw).articles, c);
    expect(kept).toHaveLength(120);
    expect(kept.filter((a) => a.title.includes("Pune")).length).toBe(100); // Pune items rank first
  });
});

describe("G19 idempotency key", () => {
  it("ISO week in IST", () => {
    expect(isoWeekKey(NOW)).toBe("2026-W42");
    expect(isoWeekKey(new Date("2026-10-11T18:29:00Z"))).toBe("2026-W41"); // Sun 23:59 IST
  });
});
