import fixtures from "@/seed/sample_articles.json";
import type { Article } from "@/lib/types";
import { normalize } from "@/lib/pipeline/clean";
import { loadFixtures } from "@/lib/sources/demo";
import { seedAppConfig } from "@/lib/config";
import type { LlmFn } from "@/lib/pipeline/classify";

export const NOW = new Date("2026-10-12T01:30:00Z"); // a Monday, 07:00 IST
export const config = () => seedAppConfig();

export function fixtureArticles(now = NOW): Article[] {
  return normalize(loadFixtures(now)).articles;
}
export const byFixture = (arts: Article[], id: string) => arts.find((a) => a.fixtureId === id)!;

type Exp = { signal?: string; sector?: string; geo?: string; verdict?: string };
const expected = new Map(fixtures.articles.map((f) => [f.id, f.expected as Exp]));

/** Hand-written "ideal analyst" answers for each fixture — what a well-behaved Gemini should return. */
const ORACLE: Record<string, Partial<Record<string, unknown>>> = {
  "fx-01": { company: "Vardhan Auto Components", evidence: "seeking implementation partners for a ₹6 crore programme to train 3,000 school dropouts", geo_mentions: ["Pune", "Chakan", "Pimpri"], amount_inr_crore: 6, beneficiaries: "3,000 school dropouts", deadline: "month-end", confidence: 0.92 },
  "fx-02": { company: "Kalpataru Fintech", evidence: "announced a new CSR initiative to deliver digital literacy training", geo_mentions: ["Maharashtra"], beneficiaries: "10,000 first-generation college students", confidence: 0.88 },
  "fx-03": { company: "Nirmal Steel", evidence: "CSR spend rose to ₹48 crore from ₹31 crore", amount_inr_crore: 48, confidence: 0.85 },
  "fx-04": { company: null, evidence: "notified amendments to the Companies (CSR Policy) Rules", confidence: 0.9 },
  "fx-05": { company: "Vardhan Auto Components", evidence: null, confidence: 0.9 },
  "fx-07": { company: "Sahyadri Cements", evidence: null, confidence: 0.85 },
  "fx-09": { company: "Orion Pharma", evidence: "Orion Pharma will expand its STEM scholarships for girls", confidence: 0.7, injection_flag: true },
  "fx-10": { company: "Brightline Bank", evidence: "Brightline Bank announced a youth employability programme", confidence: 0.55 },
  "fx-11": { company: null, evidence: null, confidence: 0.9 },
  "fx-12": { company: "Deccan Logistics", evidence: "will support upgrades at ITIs in Nashik under its CSR plan", geo_mentions: ["Nashik"], amount_inr_crore: null, confidence: 0.8 },
};

export const oracleLlm: LlmFn = async ({ user }) => {
  const items = JSON.parse(user.slice(user.indexOf("```json") + 7, user.lastIndexOf("```"))) as { id: string }[];
  return JSON.stringify(
    items.map((it) => {
      const e = expected.get(it.id) ?? {};
      const o = ORACLE[it.id] ?? {};
      return {
        id: it.id,
        signal: e.signal ?? "IRRELEVANT",
        company: o.company ?? null,
        primary_sector: e.sector ?? (e.signal && e.signal !== "IRRELEVANT" && e.signal !== "POLICY" ? "education" : null),
        secondary_sectors: [],
        geo_mentions: o.geo_mentions ?? [],
        amount_inr_crore: o.amount_inr_crore ?? null,
        beneficiaries: o.beneficiaries ?? null,
        deadline: o.deadline ?? null,
        evidence: o.evidence ?? null,
        one_line_summary: `summary of ${it.id}`,
        confidence: o.confidence ?? 0.8,
        injection_flag: o.injection_flag ?? false,
      };
    }),
  );
};
