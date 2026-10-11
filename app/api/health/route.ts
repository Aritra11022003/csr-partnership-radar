import { configuredModel, geminiConfigured } from "@/lib/gemini";
import { getStore } from "@/lib/store";
import { isDemoMode } from "@/lib/sources/demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Non-secret readiness info (G7: booleans only, never values). */
export async function GET() {
  return Response.json({
    ok: true,
    gemini: geminiConfigured(),
    model: configuredModel(),
    store: getStore().kind,
    email: !!process.env.RESEND_API_KEY,
    cronSecret: !!process.env.CRON_SECRET,
    adminToken: !!process.env.ADMIN_TOKEN,
    demoMode: isDemoMode(),
  });
}
