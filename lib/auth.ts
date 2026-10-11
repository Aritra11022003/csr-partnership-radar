/** G8: protected endpoints. Constant-time comparison; tokens only ever read from server env. */
import crypto from "node:crypto";

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function bearer(req: Request): string | null {
  const h = req.headers.get("authorization");
  return h?.startsWith("Bearer ") ? h.slice(7).trim() : null;
}

/** Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. */
export function isCron(req: Request): boolean {
  const s = process.env.CRON_SECRET;
  const t = bearer(req);
  return !!s && !!t && safeEqual(t, s);
}

/** Admin: `Authorization: Bearer $ADMIN_TOKEN` or `x-admin-token` header. */
export function isAdmin(req: Request): boolean {
  const s = process.env.ADMIN_TOKEN;
  const t = req.headers.get("x-admin-token") ?? bearer(req);
  return !!s && !!t && safeEqual(t, s);
}

export const unauthorized = () => Response.json({ error: "unauthorized" }, { status: 401 });
