/**
 * Guest access for reviewers: a few low-cost actions without the admin token, capped per IST day
 * so nobody can exhaust the Gemini quota or spam inboxes. Requests that send a WRONG token are still 401.
 */
import { getStore } from "./store";
import { istDate } from "./util";

export const GUEST_LIMITS = { run: 4, email: 5 } as const;

/** True when the caller sent no admin token at all (a wrong token is not "guest", it's unauthorized). */
export function isGuest(req: Request): boolean {
  return !req.headers.get("x-admin-token") && !req.headers.get("authorization");
}

/** Consume one unit of today's guest allowance. Returns remaining count, or -1 when exhausted. */
export async function takeGuestQuota(kind: keyof typeof GUEST_LIMITS): Promise<number> {
  const key = `guest:${kind}:${istDate()}`;
  const used = (await getStore().get<number>(key)) ?? 0;
  if (used >= GUEST_LIMITS[kind]) return -1;
  await getStore().set(key, used + 1, 2 * 24 * 3600);
  return GUEST_LIMITS[kind] - used - 1;
}
