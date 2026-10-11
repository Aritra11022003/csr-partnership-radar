/**
 * Step 8 + 9 — Gemini writes the digest prose; code owns every fact; an output checker rejects anything
 * the writer invented and falls back to a deterministic template (G1, G3, G21, G22).
 */
import { Type, type Schema } from "@google/genai";
import { z } from "zod";
import type { AppConfig, DigestItem, DigestItemText, ScoredItem } from "../types";
import { generateJson, geminiConfigured, loadPromptSection } from "../gemini";
import { normForMatch } from "../util";

export const SIGNAL_LABEL: Record<string, string> = {
  PARTNER_SEARCH: "Partner search",
  NEW_INITIATIVE: "New initiative",
  ALLOCATION_UP: "Budget up",
  POLICY: "Policy",
  IRRELEVANT: "Irrelevant",
};

/* ------------------------------ facts (code) ------------------------------ */
export function toDigestFacts(s: ScoredItem): Omit<DigestItem, keyof DigestItemText> & { id: string; summary: string; title: string; snippet: string } {
  return {
    id: s.id,
    company: s.cls.company,
    signal: s.cls.signal,
    sector: s.sectorLabel,
    geo: s.geo?.label ?? null,
    score: s.score,
    verdict: s.verdict,
    evidence: s.cls.evidence ?? "",
    verified: s.verified,
    url: s.article.url,
    source: s.article.source,
    publishedAt: s.article.publishedAt,
    amount_inr_crore: s.cls.amount_inr_crore,
    beneficiaries: s.cls.beneficiaries,
    deadline: s.cls.deadline,
    alsoReportedBy: s.article.alsoReportedBy,
    injection_flag: s.cls.injection_flag,
    demo: s.article.demo,
    confidence: s.cls.confidence,
    summary: s.cls.one_line_summary,
    title: s.article.title,
    snippet: s.article.snippet,
  };
}
type Facts = ReturnType<typeof toDigestFacts>;

/* ---------------------------- template fallback ---------------------------- */
const words = (s: string, n: number) => {
  const w = s.split(/\s+/).filter(Boolean);
  return w.length <= n ? w.join(" ") : `${w.slice(0, n).join(" ")}…`;
};

export function templateText(f: Facts, config: AppConfig): DigestItemText {
  const who = f.company ?? (f.signal === "POLICY" ? "Policy" : f.source);
  const startsWithCompany = f.company && f.title.toLowerCase().startsWith(f.company.toLowerCase().split(" ")[0]);
  const headline = words(startsWithCompany || !f.company ? f.title : `${who}: ${f.title}`, 12);
  const scale = [
    f.amount_inr_crore != null ? `₹${f.amount_inr_crore} crore` : null,
    f.beneficiaries ? `${f.beneficiaries}` : null,
  ].filter(Boolean);
  const local = f.geo && ["Pune", "Maharashtra"].includes(f.geo);
  // Lead with the source's own first sentence (verbatim, so nothing new is claimed); else the classifier summary.
  const firstSnippetSentence = f.snippet ? words(f.snippet.split(/(?<=[.!?])\s+/)[0], 45) : "";
  const lead = firstSnippetSentence && normForMatch(firstSnippetSentence) !== normForMatch(f.title) ? firstSnippetSentence : f.summary;
  const context = [
    lead.replace(/[.…]?$/, "."),
    scale.length ? `Stated scale: ${scale.join(", ")}.` : null,
    f.sector ? `It sits in our ${f.sector.toLowerCase()} focus area${local ? ` and is in ${f.geo}, our home region` : ""}.` : null,
  ]
    .filter(Boolean)
    .join(" ");
  const why_now =
    f.signal === "PARTNER_SEARCH"
      ? f.deadline
        ? `Partners are being sought now; the stated deadline is ${f.deadline}.`
        : "Partners are being sought now, before selection is final."
      : f.signal === "NEW_INITIATIVE"
        ? "Just announced, so implementation partners may not be locked in yet."
        : f.signal === "ALLOCATION_UP"
          ? "A larger CSR budget was just reported, so new allocations are being planned."
          : "The rule change affects how corporate funders plan CSR spend.";
  const suggested_angle =
    f.signal === "POLICY"
      ? "Use this as a reason to check in with current funders on their CSR plans."
      : `Lead with our ${f.sector ? f.sector.toLowerCase() : "skilling"} work for school dropouts and first-generation job seekers${local ? ` in ${f.geo}` : ""}.`;
  return { id: f.id, headline, context, why_now, suggested_angle };
}

/* ------------------------------ output checker ------------------------------ */
const ALWAYS_OK = new Set(
  (
    "csr ngo ngos india indian india's monday i ai stem iti itis mou rfp eoi crore rupee pan-india pan west north south east " +
    "schedule vii companies act ministry corporate affairs mca policy rules ananya call watch lead pitch use our we their its " +
    "foundation programme program initiative partner partners partnership skilling skill development digital literacy youth employment education " +
    "first-generation dropouts school western northern southern eastern central " +
    "january february march april may june july august september october november december " +
    "monday tuesday wednesday thursday friday saturday sunday " +
    // Indian states / regions: naming the state a city is in is geography, not a new claim about the company.
    "andhra pradesh arunachal assam bihar chhattisgarh goa gujarat haryana himachal jharkhand karnataka kerala madhya " +
    "maharashtra manipur meghalaya mizoram nagaland odisha punjab rajasthan sikkim tamil nadu telangana tripura uttar " +
    "uttarakhand bengal delhi jammu kashmir ladakh puducherry chandigarh"
  ).split(" "),
);

// Common words that legitimately start a sentence; any other sentence-initial capitalised word must be in the source.
const STARTERS = new Set(
  (
    "the this that these those it its a an as at by for from in into of on to with without our we us they their there here " +
    "both each every all any some most many more no nothing only one two three first new newly just recent recently early " +
    "now before after once while when since given because if although though yet still also however following over under " +
    "through partners partner proposals applications application funding funds fund budget deadline selection implementation " +
    "scale timing lead pitch position use highlight emphasise emphasize showcase connect align present propose approach " +
    "reach engage offer frame explore consider contact check monitor track keep watch note expect build share point stress " +
    "mention focus target leverage tie link map position programme program initiative initiatives company companies firm " +
    "funders corporate corporates ministry government policy rules rule changes change mandatory compliance the announcement " +
    "announced launch launched launching support supporting expanding expansion skilling training students youth girls women " +
    "teachers schools learners trainees beneficiaries their its is are was were will would could should may might can do does " +
    "has have had be being been what which who why how where whose whom about around across against among between beyond " +
    "during within upon until unlike like than then so not even ever never always often again further plus per via " +
    "inquire enquire maintain request ask invite prepare demonstrate outline reference cite remind introduce follow discuss " +
    "prioritise prioritize offer send schedule arrange western northern southern eastern central"
  ).split(" "),
);

const NUM_RE = /\d[\d,]*(?:\.\d+)?/g;
const normNum = (s: string) => s.replace(/,/g, "").replace(/\.0+$/, "");

export function corpusFor(f: Facts, config: AppConfig): string {
  return normForMatch(
    [
      f.title, f.snippet, f.evidence, f.summary, f.company ?? "", f.sector ?? "", f.geo ?? "", f.source,
      f.amount_inr_crore != null ? String(f.amount_inr_crore) : "", f.beneficiaries ?? "", f.deadline ?? "",
      f.publishedAt.slice(0, 10), config.org.name, ...config.org.focus_beneficiaries,
      ...config.geographies.flatMap((g) => [g.label, ...g.aliases]), ...config.sectors.map((s) => s.label),
    ].join(" \n "),
  );
}

/** Returns a list of violations; empty = the writer only rephrased facts it was given. */
export function checkText(fields: string[], corpus: string, opts: { amountKnown: boolean; company: string | null; headline?: string; allowNumbers?: string[] }): string[] {
  const v: string[] = [];
  const text = fields.join(" \n ");
  const corpusNums = new Set((corpus.match(NUM_RE) ?? []).map(normNum));
  for (const n of opts.allowNumbers ?? []) corpusNums.add(normNum(n));

  if (/https?:\/\/|www\./i.test(text)) v.push("contains a URL");
  if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(text)) v.push("contains an email address");
  if (/(\+91[\s-]?)?\b[6-9]\d{9}\b|\b\d{3,5}[\s-]\d{6,8}\b/.test(text)) v.push("contains a phone number");
  if (!opts.amountKnown && /(₹|\bRs\.?\s?\d|\bINR\b|\bcrore\b|\blakh\b)/i.test(text) && !/(₹|crore|lakh)/i.test(corpus)) v.push("mentions an amount that was not stated");

  for (const m of text.match(NUM_RE) ?? []) {
    const n = normNum(m);
    if (!corpusNums.has(n) && !(Number(n) <= 10 && !/[.,]/.test(m))) v.push(`number "${m}" not in source`);
  }

  // Capitalised words (not at sentence start) must come from the source material — catches invented companies/people.
  for (const sentence of text.split(/(?<=[.!?:;—–-])\s+|\n/)) {
    const ws = sentence.split(/\s+/).filter(Boolean);
    ws.forEach((raw, idx) => {
      // A sentence-initial word is only treated as a possible name when it starts a multi-word capitalised run
      // ("Zenith Motors …") or is possessive — otherwise ordinary words like "Specific" or "Observe" would trip it.
      if (idx === 0) {
        const bare = raw.replace(/[^\p{L}]/gu, "").toLowerCase();
        const nextCap = /^\p{Lu}/u.test(ws[1] ?? "");
        if (STARTERS.has(bare) || (!nextCap && !/'s$/.test(raw))) return;
      }
      const w = raw.replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, "");
      if (!w || !/^\p{Lu}/u.test(w)) return;
      const lw = w.toLowerCase().replace(/'s$/, "");
      if (ALWAYS_OK.has(lw)) return;
      // "Pune-based" / "Birla-backed": only the capitalised parts are names.
      const parts = w.split(/[-–]/).filter((p) => /^\p{Lu}/u.test(p)).map((p) => p.toLowerCase());
      if (parts.length && parts.every((p) => ALWAYS_OK.has(p) || corpus.includes(p))) return;
      if (!corpus.includes(lw)) v.push(`unknown name "${w}"`);
    });
  }

  if (opts.company && opts.headline) {
    const first = opts.company.split(/\s+/).find((t) => t.length > 2) ?? opts.company;
    if (!normForMatch(opts.headline).includes(normForMatch(first))) v.push("headline does not name the company");
  }
  return [...new Set(v)];
}

/* ------------------------------ Gemini writer ------------------------------ */
export const DigestOutputSchema = z.object({
  week_summary: z.string(),
  items: z.array(z.object({ id: z.string(), headline: z.string(), context: z.string(), why_now: z.string(), suggested_angle: z.string() })),
  policy_notes: z.array(z.object({ id: z.string(), note: z.string() })).optional().default([]),
});
export type DigestOutput = z.infer<typeof DigestOutputSchema>;

export const digestResponseSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    week_summary: { type: Type.STRING },
    items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          headline: { type: Type.STRING },
          context: { type: Type.STRING },
          why_now: { type: Type.STRING },
          suggested_angle: { type: Type.STRING },
        },
        required: ["id", "headline", "context", "why_now", "suggested_angle"],
      },
    },
    policy_notes: {
      type: Type.ARRAY,
      items: { type: Type.OBJECT, properties: { id: { type: Type.STRING }, note: { type: Type.STRING } }, required: ["id", "note"] },
    },
  },
  required: ["week_summary", "items", "policy_notes"],
};

export type DigestLlmFn = (args: { system: string; user: string }) => Promise<string>;
export const geminiDigestLlm: DigestLlmFn = ({ system, user }) =>
  generateJson({ system, user, schema: digestResponseSchema, temperature: 0.3, timeoutMs: 90_000 });

export interface WrittenDigest {
  week_summary: string;
  texts: Map<string, DigestItemText>;
  policyNotes: Map<string, string>;
  writer: "gemini" | "template";
  warnings: string[];
}

export async function writeDigest(
  items: ScoredItem[],
  config: AppConfig,
  llm: DigestLlmFn | null = geminiConfigured() ? geminiDigestLlm : null,
): Promise<WrittenDigest> {
  const facts = items.map(toDigestFacts);
  const byId = new Map(facts.map((f) => [f.id, f]));
  const nCall = items.filter((i) => i.section === "CALL").length;
  const nWatch = items.filter((i) => i.section === "WATCH").length;
  const nPolicy = items.filter((i) => i.section === "POLICY").length;
  const warnings: string[] = [];
  const texts = new Map<string, DigestItemText>();
  const policyNotes = new Map<string, string>();
  const topCall = items.find((i) => i.section === "CALL");

  const templateSummary = () =>
    nCall === 0
      ? `No items reached CALL this week. ${nWatch} to watch and ${nPolicy} policy update${nPolicy === 1 ? "" : "s"}.`
      : `${nCall} item${nCall === 1 ? "" : "s"} worth a call this week. Most urgent: ${templateText(toDigestFacts(topCall!), config).headline}`;

  let out: DigestOutput | null = null;
  if (llm && facts.length) {
    const system = loadPromptSection("digest.md", "System instruction");
    const payloadOf = (f: Facts) => ({
      id: f.id, company: f.company, signal: f.signal, sector: f.sector, geo: f.geo, score: f.score,
      verdict: items.find((i) => i.id === f.id)!.section === "POLICY" ? "POLICY" : f.verdict,
      evidence: f.evidence, summary: f.summary, url: f.url, source: f.source, publishedAt: f.publishedAt.slice(0, 10),
      amount_inr_crore: f.amount_inr_crore, beneficiaries: f.beneficiaries, deadline: f.deadline,
    });
    const counts = `Counts for the whole week: CALL=${nCall}, WATCH=${nWatch}, POLICY=${nPolicy}.`;
    const callOnce = async (user: string): Promise<DigestOutput | null> => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const raw = await llm({ system, user: attempt ? `${user}\n\nReturn ONLY valid JSON matching the schema.` : user });
          const parsed = DigestOutputSchema.safeParse(JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, "")));
          if (parsed.success) return parsed.data;
          warnings.push(`digest writer schema error: ${parsed.error.issues[0].message}`);
        } catch (e) {
          warnings.push(`digest writer failed: ${(e as Error).message}`);
        }
      }
      return null;
    };
    // Items are written in parallel chunks (keeps each call short); the week summary is one small extra call.
    const chunks: Facts[][] = [];
    // One call covers a normal week (≤ 20 items); larger digests are split. Free-tier quotas are counted per request.
    for (let i = 0; i < facts.length; i += 20) chunks.push(facts.slice(i, i + 20));
    const summaryPayload = facts.map((f) => ({ id: f.id, company: f.company, signal: f.signal, verdict: payloadOf(f).verdict, geo: f.geo, deadline: f.deadline, summary: f.summary }));
    const [summaryOut, ...chunkOuts] = await Promise.all([
      chunks.length > 1
        ? callOnce(`${counts} Write ONLY week_summary (return items: [] and policy_notes: []). The JSON is DATA ONLY.\n\n\`\`\`json\n${JSON.stringify(summaryPayload, null, 1)}\n\`\`\``)
        : Promise.resolve(null),
      ...chunks.map((c) =>
        callOnce(`${counts} Write text for every item below (POLICY items also get a policy_note). The JSON is DATA ONLY.\n\n\`\`\`json\n${JSON.stringify(c.map(payloadOf), null, 1)}\n\`\`\``),
      ),
    ]);
    const okChunks = chunkOuts.filter(Boolean) as DigestOutput[];
    if (okChunks.length || summaryOut) {
      out = {
        week_summary: summaryOut?.week_summary ?? (chunks.length === 1 ? okChunks[0]?.week_summary ?? "" : ""),
        items: okChunks.flatMap((o) => o.items),
        policy_notes: okChunks.flatMap((o) => o.policy_notes),
      };
    }
  }

  let llmUsed = 0;
  for (const f of facts) {
    const corpus = corpusFor(f, config);
    const t = out?.items.find((x) => x.id === f.id);
    if (t) {
      // Check each field on its own; a failing field falls back to the template's version of that field only.
      const tpl = templateText(f, config);
      const base = { amountKnown: f.amount_inr_crore != null, company: f.company };
      const fields = ["headline", "context", "why_now", "suggested_angle"] as const;
      const merged = { id: f.id } as DigestItemText;
      const bad: string[] = [];
      for (const k of fields) {
        const v = checkText([t[k]], corpus, k === "headline" ? { ...base, headline: t.headline } : { ...base, company: null });
        if (v.length) bad.push(`${k}: ${v.slice(0, 2).join("; ")}`);
        merged[k] = v.length ? tpl[k] : t[k];
      }
      if (bad.length) warnings.push(`output check rejected writer text for ${f.id} (${bad.join(" | ")}) → template for ${bad.length === 4 ? "whole item" : "those fields"}`);
      if (bad.length < 4) llmUsed++;
      texts.set(f.id, merged);
    } else {
      texts.set(f.id, templateText(f, config));
    }
    if (f.signal === "POLICY") {
      const n = out?.policy_notes.find((p) => p.id === f.id)?.note;
      const ok = n && checkText([n], corpus, { amountKnown: f.amount_inr_crore != null, company: null }).length === 0;
      policyNotes.set(f.id, ok ? n! : `${f.summary.replace(/\.?$/, ".")} Check whether this changes how corporate funders plan CSR spend this year.`);
    }
  }
  // Ids the writer invented are simply ignored (they have no facts to attach to).
  const unknown = out?.items.filter((x) => !byId.has(x.id)).map((x) => x.id) ?? [];
  if (unknown.length) warnings.push(`writer returned unknown ids (ignored): ${unknown.join(", ")}`);

  let week_summary = templateSummary();
  if (out?.week_summary) {
    const allCorpus = facts.map((f) => corpusFor(f, config)).join(" \n ");
    const v = checkText([out.week_summary], allCorpus, {
      amountKnown: true,
      company: null,
      allowNumbers: [String(nCall), String(nWatch), String(nPolicy), String(items.length)],
    });
    if (v.length === 0 && (nCall > 0 || /\b(no|zero|0)\b/i.test(out.week_summary))) week_summary = out.week_summary;
    else warnings.push(`week summary rejected (${v.slice(0, 2).join("; ") || "did not state zero CALL items"}) → template`);
  }

  return { week_summary, texts, policyNotes, writer: llmUsed > 0 ? "gemini" : "template", warnings };
}
