/**
 * The ONLY AI provider in this app: Google Gemini Flash via @google/genai (G9).
 * Model comes from env GEMINI_MODEL. If that model id is unavailable, we fall back down the Flash family only.
 */
import { GoogleGenAI, type Schema } from "@google/genai";
import fs from "node:fs";
import path from "node:path";
import { redact } from "./util";

export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
const FLASH_FALLBACKS = ["gemini-3.5-flash", "gemini-2.5-flash", "gemini-flash-latest"];

let client: GoogleGenAI | null = null;
let resolvedModel: string | null = null;

export const geminiConfigured = () => !!process.env.GEMINI_API_KEY;
export const configuredModel = () => process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
export const activeModel = () => resolvedModel ?? configuredModel();

function getClient() {
  if (!client) client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  return client;
}

export interface GenJsonArgs {
  system: string;
  user: string;
  schema?: Schema;
  temperature: number;
  timeoutMs?: number;
}

/** Calls Gemini with JSON mode + responseSchema and returns the raw text (validated by the caller with zod). */
export async function generateJson({ system, user, schema, temperature, timeoutMs = 60_000 }: GenJsonArgs): Promise<string> {
  if (!geminiConfigured()) throw new Error("GEMINI_API_KEY not set");
  const candidates = resolvedModel ? [resolvedModel] : [configuredModel(), ...FLASH_FALLBACKS.filter((m) => m !== configuredModel())];
  let lastErr: unknown;
  for (const model of candidates) {
    try {
      const call = getClient().models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: user }] }],
        config: {
          systemInstruction: system,
          temperature,
          responseMimeType: "application/json",
          ...(schema ? { responseSchema: schema } : {}),
        },
      });
      const res = await Promise.race([
        call,
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`Gemini timeout after ${timeoutMs}ms`)), timeoutMs)),
      ]);
      resolvedModel = model;
      const text = res.text;
      if (!text) throw new Error("Gemini returned an empty response");
      return text;
    } catch (e) {
      lastErr = e;
      const msg = String((e as Error).message ?? e);
      // Only walk the fallback list when the model id itself is the problem.
      if (!/not found|404|is not supported|unknown model|invalid model/i.test(msg)) break;
      console.warn(`[gemini] model ${model} unavailable, trying next Flash model`);
    }
  }
  throw new Error(redact(String((lastErr as Error)?.message ?? lastErr)));
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
