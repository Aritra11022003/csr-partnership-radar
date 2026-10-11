/**
 * The ONLY AI provider in this app: Google Gemini Flash via @google/genai (G9).
 * Model comes from env GEMINI_MODEL. If that model id is unavailable, we fall back down the Flash family only.
 */
import { GoogleGenAI, ThinkingLevel, type Schema, type ThinkingConfig } from "@google/genai";
import fs from "node:fs";
import path from "node:path";
import { redact } from "./util";

export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
// Flash family only. Each model has its own free-tier daily quota, so a run can continue on the next one.
const FLASH_FALLBACKS = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-flash-latest", "gemini-3.5-flash-lite"];
const MAX_CONCURRENT = 3;

let client: GoogleGenAI | null = null;
let resolvedModel: string | null = null;
const unavailable = new Set<string>(); // models that 404'd or hit their daily quota in this process

export const geminiConfigured = () => !!process.env.GEMINI_API_KEY;
export const configuredModel = () => process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
export const activeModel = () => resolvedModel ?? configuredModel();

function getClient() {
  if (!client) client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  return client;
}

/** Classification and rephrasing don't need deep reasoning; low thinking keeps a run well inside the time limit. */
function thinkingFor(model: string): ThinkingConfig | undefined {
  if (process.env.GEMINI_THINKING === "default") return undefined;
  if (/gemini-[3-9]/.test(model)) return { thinkingLevel: ThinkingLevel.LOW };
  if (/2\.5-flash/.test(model)) return { thinkingBudget: 0 };
  return undefined;
}

export type GeminiErrorKind = "model_unavailable" | "daily_quota" | "rate_limit" | "overloaded" | "thinking_unsupported" | "timeout" | "other";

/** Pure: decide what to do with a Gemini error message (unit-tested). */
export function classifyGeminiError(msg: string): { kind: GeminiErrorKind; retryAfterMs?: number } {
  if (/thinking/i.test(msg) && /(invalid|not supported|unsupported|unknown)/i.test(msg)) return { kind: "thinking_unsupported" };
  if (/"code":\s*404|not found|no longer available|is not supported for|unknown model|invalid model/i.test(msg)) return { kind: "model_unavailable" };
  if (/"code":\s*429|RESOURCE_EXHAUSTED|quota/i.test(msg)) {
    if (/PerDay/i.test(msg)) return { kind: "daily_quota" };
    const d = /"retryDelay":\s*"(\d+(?:\.\d+)?)s"/.exec(msg) ?? /retry in (\d+(?:\.\d+)?)s/i.exec(msg);
    return { kind: "rate_limit", retryAfterMs: d ? Math.ceil(Number(d[1]) * 1000) : 10_000 };
  }
  if (/"code":\s*(500|503)|UNAVAILABLE|overloaded|high demand/i.test(msg)) return { kind: "overloaded" };
  if (/timeout/i.test(msg)) return { kind: "timeout" };
  return { kind: "other" };
}

/* simple semaphore so batches never burst past the per-minute limit */
let inFlight = 0;
const waiters: (() => void)[] = [];
async function acquire() {
  if (inFlight < MAX_CONCURRENT) {
    inFlight++;
    return;
  }
  await new Promise<void>((r) => waiters.push(r));
  inFlight++;
}
function release() {
  inFlight--;
  waiters.shift()?.();
}

export interface GenJsonArgs {
  system: string;
  user: string;
  schema?: Schema;
  temperature: number;
  timeoutMs?: number;
}

/** Calls Gemini with JSON mode + responseSchema and returns the raw text (validated by the caller with zod). */
export async function generateJson(args: GenJsonArgs): Promise<string> {
  if (!geminiConfigured()) throw new Error("GEMINI_API_KEY not set");
  await acquire();
  try {
    return await generateJsonInner(args);
  } finally {
    release();
  }
}

async function generateJsonInner({ system, user, schema, temperature, timeoutMs = 60_000 }: GenJsonArgs): Promise<string> {
  const order = [...new Set([resolvedModel ?? configuredModel(), configuredModel(), ...FLASH_FALLBACKS])].filter((m) => !unavailable.has(m));
  let lastErr: unknown = new Error("all Gemini Flash models unavailable (quota or 404)");
  let noThinking = false;
  for (let i = 0; i < order.length; i++) {
    const model = order[i];
    let sameModelRetries = 0;
    for (;;) {
      try {
        const call = getClient().models.generateContent({
          model,
          contents: [{ role: "user", parts: [{ text: user }] }],
          config: {
            systemInstruction: system,
            temperature,
            responseMimeType: "application/json",
            ...(schema ? { responseSchema: schema } : {}),
            ...(thinkingFor(model) && !noThinking ? { thinkingConfig: thinkingFor(model) } : {}),
          },
        });
        let timer: ReturnType<typeof setTimeout> | undefined;
        const res = await Promise.race([
          call,
          new Promise<never>((_, rej) => (timer = setTimeout(() => rej(new Error(`Gemini timeout after ${timeoutMs}ms`)), timeoutMs))),
        ]).finally(() => clearTimeout(timer));
        resolvedModel = model;
        const text = res.text;
        if (!text) throw new Error("Gemini returned an empty response");
        return text;
      } catch (e) {
        lastErr = e;
        const { kind, retryAfterMs } = classifyGeminiError(String((e as Error).message ?? e));
        if (kind === "thinking_unsupported" && !noThinking) {
          noThinking = true;
          continue;
        }
        if (kind === "rate_limit" && retryAfterMs! <= 30_000 && sameModelRetries++ < 2) {
          await new Promise((r) => setTimeout(r, retryAfterMs));
          continue;
        }
        if (kind === "overloaded" && sameModelRetries++ < 1) {
          await new Promise((r) => setTimeout(r, 2_000));
          continue;
        }
        if (kind === "model_unavailable" || kind === "daily_quota") {
          unavailable.add(model);
          if (resolvedModel === model) resolvedModel = null;
          console.warn(`[gemini] ${model}: ${kind} → trying next Flash model`);
          break; // next model
        }
        if (kind === "rate_limit" || kind === "overloaded") break; // next model
        throw new Error(redact(String((e as Error).message ?? e)).slice(0, 500));
      }
    }
  }
  throw new Error(redact(String((lastErr as Error)?.message ?? lastErr)).slice(0, 500));
}

/* ------------------------- prompt files (single source of truth) ------------------------- */
const promptCache = new Map<string, string>();

export function loadPromptSection(file: "classify.md" | "digest.md", heading: string): string {
  const key = `${file}#${heading}`;
  if (promptCache.has(key)) return promptCache.get(key)!;
  const md = fs.readFileSync(path.join(process.cwd(), "prompts", file), "utf8");
  const start = md.indexOf(`## ${heading}`);
  if (start < 0) throw new Error(`Section "${heading}" not found in prompts/${file}`);
  const rest = md.slice(start + heading.length + 3);
  const end = rest.search(/\n## /);
  const section = (end < 0 ? rest : rest.slice(0, end)).trim();
  promptCache.set(key, section);
  return section;
}
