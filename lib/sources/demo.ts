import fixtures from "@/seed/sample_articles.json";
import type { RawArticle, SourceStatus } from "../types";
import { DAY_MS } from "../util";

/** Synthetic fixtures — only loaded when DEMO_MODE=true or in tests (G23). Dates are relative to `now`. */
export function loadFixtures(now: Date = new Date()): RawArticle[] {
  return fixtures.articles.map((f) => ({
    title: f.title,
    snippet: f.snippet,
    url: f.url,
    source: f.source,
    publishedAt: new Date(now.getTime() - f.daysAgo * DAY_MS - 60 * 60 * 1000).toISOString(),
    sourceName: "DEMO fixtures",
    demo: true,
    fixtureId: f.id,
  }));
}

export function fixtureStatus(count: number): SourceStatus {
  return { name: "DEMO fixtures", ok: true, count, ms: 0 };
}

export const isDemoMode = () => String(process.env.DEMO_MODE).toLowerCase() === "true";
