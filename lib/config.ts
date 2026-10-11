import { z } from "zod";
import seedConfig from "@/seed/config.json";
import seedWatchlist from "@/seed/watchlist_companies.json";
import { getStore, KEYS } from "./store";
import type { AppConfig } from "./types";

const str = z.string().trim().min(1);

export const ConfigSchema = z.object({
  org: z.object({
    name: str,
    focus_beneficiaries: z.array(str),
    recipients: z.array(z.string().email()),
  }),
  lookback_days: z.number().int().min(1).max(31),
  sectors: z
    .array(z.object({ id: str.regex(/^[a-z0-9_]+$/), label: str, enabled: z.boolean(), keywords: z.array(str).min(1) }))
    .min(1),
  csr_anchor_terms: z.array(str).min(1),
  signal_keywords: z.object({
    PARTNER_SEARCH: z.array(str),
    NEW_INITIATIVE: z.array(str),
    ALLOCATION_UP: z.array(str),
    POLICY: z.array(str),
  }),
  geographies: z
    .array(z.object({ id: str.regex(/^[a-z0-9_]+$/), label: str, tier: z.number().int().min(1).max(9), aliases: z.array(str).min(1) }))
    .min(1),
  scoring: z.object({
    signal_weight: z.object({
      PARTNER_SEARCH: z.number(),
      NEW_INITIATIVE: z.number(),
      ALLOCATION_UP: z.number(),
      POLICY: z.number(),
    }),
    sector_match: z.object({ primary: z.number(), secondary: z.number() }),
    geo_weight: z.record(z.string(), z.number()),
    recency: z.record(z.string(), z.number()),
    watchlist_bonus: z.number(),
    source_credibility: z.object({ high: z.number(), medium: z.number(), low: z.number() }),
    unverified_evidence_penalty: z.number(),
    verdict_thresholds: z.object({ CALL: z.number(), WATCH: z.number() }),
    rules: z.array(z.string()).optional(),
  }),
  source_credibility: z.object({ high: z.array(str), medium: z.array(str), low_default: z.boolean() }),
  sector_feeds: z.array(z.object({ name: str, url: z.string().url(), verify: z.boolean(), enabled: z.boolean().optional() })),
  policy_queries: z.array(str),
  limits: z.object({
    max_queries: z.number().int().min(1).max(80),
    max_items_to_llm: z.number().int().min(1).max(120), // G17 hard cap
    llm_batch_size: z.number().int().min(1).max(20),
    max_digest_items: z.number().int().min(1).max(40),
  }),
  watchlist: z.array(z.object({ name: str, aliases: z.array(str), hq_geo: str })),
});

export function seedAppConfig(): AppConfig {
  const base = structuredClone(seedConfig) as unknown as Omit<AppConfig, "watchlist">;
  const recipients = (process.env.DIGEST_TO_EMAILS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (recipients.length) base.org.recipients = recipients;
  return { ...base, watchlist: structuredClone(seedWatchlist.companies) } as AppConfig;
}

/** Load config: Redis (saved via /settings) → fall back to seed files. */
export async function loadConfig(): Promise<{ config: AppConfig; source: "store" | "seed" }> {
  try {
    const saved = await getStore().get<AppConfig>(KEYS.config);
    if (saved) {
      const parsed = ConfigSchema.safeParse(saved);
      if (parsed.success) return { config: parsed.data as AppConfig, source: "store" };
      console.warn("[config] stored config invalid, using seed:", parsed.error.issues[0]);
    }
  } catch (e) {
    console.warn("[config] store unavailable, using seed:", (e as Error).message);
  }
  return { config: seedAppConfig(), source: "seed" };
}

export async function saveConfig(input: unknown): Promise<{ ok: true; config: AppConfig } | { ok: false; error: string }> {
  const parsed = ConfigSchema.safeParse(input);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return { ok: false, error: `${i.path.join(".")}: ${i.message}` };
  }
  await getStore().set(KEYS.config, parsed.data);
  return { ok: true, config: parsed.data as AppConfig };
}

export const enabledSectors = (c: AppConfig) => c.sectors.filter((s) => s.enabled);
