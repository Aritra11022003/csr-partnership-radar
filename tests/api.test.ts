import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryStore, setStore } from "@/lib/store";
import { redact } from "@/lib/util";
import { feedbackSig } from "@/lib/email/render";

beforeEach(() => {
  setStore(memoryStore());
  vi.stubEnv("CRON_SECRET", "cron-secret-123456");
  vi.stubEnv("ADMIN_TOKEN", "admin-token-123456");
});
afterEach(() => {
  setStore(null);
  vi.unstubAllEnvs();
});

describe("G8 protected endpoints", () => {
  it("/api/run: cron path without a token → 401; wrong tokens → 401", async () => {
    const { GET, POST } = await import("@/app/api/run/route");
    expect((await GET(new Request("http://x/api/run"))).status).toBe(401);
    expect((await POST(new Request("http://x/api/run", { method: "POST", headers: { "x-admin-token": "nope" } }))).status).toBe(401);
    expect((await GET(new Request("http://x/api/run", { headers: { authorization: "Bearer wrong" } }))).status).toBe(401);
    // the admin token is not accepted as the cron secret's place on POST either way round with a wrong value
    expect((await POST(new Request("http://x/api/run", { method: "POST", headers: { "x-admin-token": "cron-secret-123456" } }))).status).toBe(401);
  });
  it("guests (no token) get a small daily allowance, then 429", async () => {
    const { POST } = await import("@/app/api/run/route");
    const { getStore } = await import("@/lib/store");
    const { istDate } = await import("@/lib/util");
    const { GUEST_LIMITS } = await import("@/lib/guest");
    await getStore().set(`guest:run:${istDate()}`, GUEST_LIMITS.run);
    const res = await POST(new Request("http://x/api/run", { method: "POST", body: JSON.stringify({ sendEmail: true }) }));
    expect(res.status).toBe(429);
  });
  it("cron is idempotent per ISO week: a second firing is skipped", async () => {
    const { GET } = await import("@/app/api/run/route");
    const { getStore, KEYS } = await import("@/lib/store");
    const { isoWeekKey } = await import("@/lib/util");
    await getStore().set(KEYS.runLock(isoWeekKey()), { at: "earlier" });
    const res = await GET(new Request("http://x/api/run", { headers: { authorization: "Bearer cron-secret-123456" } }));
    expect(await res.json()).toMatchObject({ skipped: true });
  });
  it("/api/settings/preview is public and saves nothing", async () => {
    const { POST } = await import("@/app/api/settings/preview/route");
    const { GET } = await import("@/app/api/settings/route");
    const { seedAppConfig } = await import("@/lib/config");
    const c = seedAppConfig();
    c.sectors.push({ id: "women_livelihoods", label: "Women Livelihoods", enabled: true, keywords: ["self-help groups"] });
    const j = await (await POST(new Request("http://x", { method: "POST", body: JSON.stringify(c) }))).json();
    expect(j.queries.join(" ")).toMatch(/self-help groups/);
    expect((await (await GET()).json()).source).toBe("seed");
  });
  it("/api/settings PUT without a token → 401; invalid body → 400", async () => {
    const { PUT } = await import("@/app/api/settings/route");
    expect((await PUT(new Request("http://x/api/settings", { method: "PUT", body: "{}" }))).status).toBe(401);
    const res = await PUT(new Request("http://x/api/settings", { method: "PUT", headers: { "x-admin-token": "admin-token-123456" }, body: JSON.stringify({ sectors: [] }) }));
    expect(res.status).toBe(400);
  });
  it("/api/settings PUT with token + valid config saves it", async () => {
    const { PUT, GET } = await import("@/app/api/settings/route");
    const { seedAppConfig } = await import("@/lib/config");
    const c = seedAppConfig();
    c.geographies[0].aliases.push("Baner");
    const res = await PUT(new Request("http://x/api/settings", { method: "PUT", headers: { "x-admin-token": "admin-token-123456" }, body: JSON.stringify(c) }));
    expect(res.status).toBe(200);
    const got = await (await GET()).json();
    expect(got.source).toBe("store");
    expect(got.config.geographies[0].aliases).toContain("Baner");
  });
  it("feedback links must carry a valid signature", async () => {
    const { GET } = await import("@/app/api/feedback/route");
    expect((await GET(new Request("http://x/api/feedback?d=2026-10-12&i=fx-01&k=up&s=forged"))).status).toBe(400);
    const s = feedbackSig("2026-10-12", "fx-01", "up");
    expect((await GET(new Request(`http://x/api/feedback?d=2026-10-12&i=fx-01&k=up&s=${s}`))).status).toBe(200);
  });
});

describe("G7 secrets safe", () => {
  it("redacts env secrets and key-like query params from log strings", () => {
    vi.stubEnv("GEMINI_API_KEY", "AIzaSyTESTKEY1234567890");
    const s = redact("failed calling https://x?key=AIzaSyTESTKEY1234567890 with AIzaSyTESTKEY1234567890");
    expect(s).not.toMatch(/AIzaSyTESTKEY/);
  });
  it("health endpoint exposes booleans only", async () => {
    vi.stubEnv("GEMINI_API_KEY", "AIzaSyTESTKEY1234567890");
    const { GET } = await import("@/app/api/health/route");
    const txt = JSON.stringify(await (await GET()).json());
    expect(txt).not.toMatch(/AIzaSy|cron-secret|admin-token/);
  });
});

describe("admin email resend", () => {
  it("wrong token → 401; guests must name exactly one address", async () => {
    const { POST } = await import("@/app/api/send-email/route");
    expect((await POST(new Request("http://x/api/send-email", { method: "POST", headers: { "x-admin-token": "nope" }, body: "{}" }))).status).toBe(401);
    expect((await POST(new Request("http://x/api/send-email", { method: "POST", body: JSON.stringify({ to: ["a@b.co", "c@d.co"] }) }))).status).toBe(400);
  });
  it("sends a stored digest to chosen recipients via Resend, ignoring the weekly lock", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    const { runPipeline } = await import("@/lib/run");
    const { seedAppConfig } = await import("@/lib/config");
    const { digest } = await runPipeline({ trigger: "test", demo: true, offline: true, config: seedAppConfig(), classifyLlm: null, digestLlm: null, log: () => {} });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "em_9" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { POST } = await import("@/app/api/send-email/route");
    const res = await POST(new Request("http://x/api/send-email", { method: "POST", headers: { "x-admin-token": "admin-token-123456" }, body: JSON.stringify({ id: digest.id, to: ["team@ngo.org"] }) }));
    expect(res.status).toBe(200);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).to).toEqual(["team@ngo.org"]);
    // guest with one address works too, without the token
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "em_10" }), { status: 200 }));
    const guest = await POST(new Request("http://x/api/send-email", { method: "POST", body: JSON.stringify({ id: digest.id, to: ["grader@uni.edu"] }) }));
    expect(guest.status).toBe(200);
    const bad = await POST(new Request("http://x/api/send-email", { method: "POST", headers: { "x-admin-token": "admin-token-123456" }, body: JSON.stringify({ id: digest.id, to: ["not-an-email"] }) }));
    expect(bad.status).toBe(400);
    vi.unstubAllGlobals();
  });
});
