/** Email HTML (table layout + inline styles so it renders in Gmail/Outlook). Rendered by code, not the LLM. */
import crypto from "node:crypto";
import type { Digest, DigestItem } from "../types";
import { SIGNAL_LABEL } from "../pipeline/digest";

export function baseUrl(): string {
  const explicit = process.env.APP_BASE_URL?.replace(/\/$/, "");
  if (explicit) return explicit;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

const secret = () => process.env.ADMIN_TOKEN || process.env.CRON_SECRET || "dev-secret";
export function feedbackSig(digestId: string, itemId: string, kind: string): string {
  return crypto.createHmac("sha256", secret()).update(`${digestId}|${itemId}|${kind}`).digest("hex").slice(0, 16);
}
export function feedbackUrl(digestId: string, itemId: string, kind: "up" | "down" | "called"): string {
  const q = new URLSearchParams({ d: digestId, i: itemId, k: kind, s: feedbackSig(digestId, itemId, kind) });
  return `${baseUrl()}/api/feedback?${q}`;
}

const esc = (s: string | null | undefined) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

const C = {
  ink: "#1b2333",
  muted: "#5b6577",
  line: "#e3e7ee",
  bg: "#f4f6f9",
  call: "#1f7a4d",
  callBg: "#e7f5ee",
  watch: "#946200",
  watchBg: "#fdf4e0",
  policy: "#3b4fa8",
  policyBg: "#eceffc",
};

function chip(text: string, fg: string, bg: string) {
  return `<span style="display:inline-block;padding:2px 8px;border-radius:999px;background:${bg};color:${fg};font-size:11px;font-weight:600;letter-spacing:.02em;margin-right:4px">${esc(text)}</span>`;
}

function tags(i: DigestItem) {
  return [i.sector, i.geo, SIGNAL_LABEL[i.signal]]
    .filter(Boolean)
    .map((t) => `<span style="color:${C.muted};font-size:12px">${esc(t)}</span>`)
    .join(`<span style="color:${C.line}"> &nbsp;·&nbsp; </span>`);
}

function sourceLine(i: DigestItem) {
  const also = i.alsoReportedBy.length ? ` <span style="color:${C.muted}">+${i.alsoReportedBy.length} more source${i.alsoReportedBy.length > 1 ? "s" : ""}</span>` : "";
  return `<a href="${esc(i.url)}" style="color:${C.policy};text-decoration:none">${esc(i.source)} ↗</a> <span style="color:${C.muted}">· ${fmtDate(i.publishedAt)}</span>${also}`;
}

function feedbackLinks(d: Digest, i: DigestItem) {
  const a = (k: "up" | "down" | "called", label: string) =>
    `<a href="${feedbackUrl(d.id, i.id, k)}" style="color:${C.muted};text-decoration:none;border:1px solid ${C.line};border-radius:6px;padding:3px 8px;font-size:12px;margin-right:6px">${label}</a>`;
  return `${a("up", "👍 Useful")}${a("down", "👎 Not useful")}${a("called", "📞 Called")}`;
}

function flags(i: DigestItem) {
  const f: string[] = [];
  if (i.demo) f.push(chip("DEMO", "#8a1c1c", "#fde8e8"));
  if (!i.verified) f.push(chip("evidence unverified", "#8a1c1c", "#fde8e8"));
  if (i.injection_flag) f.push(chip("suspicious text in source", "#8a1c1c", "#fde8e8"));
  return f.join("");
}

function callCard(d: Digest, i: DigestItem) {
  return `
<tr><td style="padding:0 0 14px">
 <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid ${C.line};border-left:4px solid ${C.call};border-radius:8px">
  <tr><td style="padding:16px 18px">
   <div style="margin-bottom:6px">${chip("CALL", C.call, C.callBg)}${chip(`score ${i.score}`, C.muted, C.bg)}${flags(i)}</div>
   <div style="font-size:17px;font-weight:700;color:${C.ink};line-height:1.35;margin-bottom:4px">${esc(i.headline)}</div>
   <div style="margin-bottom:10px">${tags(i)}</div>
   <div style="font-size:14px;color:${C.ink};line-height:1.55;margin-bottom:8px">${esc(i.context)}</div>
   <div style="font-size:14px;color:${C.ink};line-height:1.5;margin-bottom:4px"><b>Why now:</b> ${esc(i.why_now)}</div>
   <div style="font-size:14px;color:${C.ink};line-height:1.5;margin-bottom:10px"><b>Angle:</b> ${esc(i.suggested_angle)}</div>
   <div style="font-size:13px;color:${C.muted};font-style:italic;border-left:3px solid ${C.line};padding-left:10px;margin-bottom:10px">“${esc(i.evidence)}”</div>
   <div style="font-size:13px;margin-bottom:12px">${sourceLine(i)}</div>
   <div>${feedbackLinks(d, i)}</div>
  </td></tr>
 </table>
</td></tr>`;
}

function watchCard(d: Digest, i: DigestItem) {
  return `
<tr><td style="padding:0 0 10px">
 <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid ${C.line};border-left:4px solid #e0a800;border-radius:8px">
  <tr><td style="padding:12px 16px">
   <div style="font-size:15px;font-weight:600;color:${C.ink};line-height:1.35">${esc(i.headline)} ${flags(i)}</div>
   <div style="margin:3px 0 6px">${tags(i)} <span style="color:${C.muted};font-size:12px">· score ${i.score}</span></div>
   <div style="font-size:13px;color:${C.ink};line-height:1.5;margin-bottom:6px">${esc(i.context)} <b>Why now:</b> ${esc(i.why_now)}</div>
   <div style="font-size:12px;color:${C.muted};font-style:italic;margin-bottom:6px">“${esc(i.evidence)}”</div>
   <div style="font-size:12px">${sourceLine(i)} &nbsp; <a href="${feedbackUrl(d.id, i.id, "up")}" style="text-decoration:none">👍</a> <a href="${feedbackUrl(d.id, i.id, "down")}" style="text-decoration:none">👎</a> <a href="${feedbackUrl(d.id, i.id, "called")}" style="text-decoration:none">📞</a></div>
  </td></tr>
 </table>
</td></tr>`;
}

function policyCard(i: DigestItem & { note: string }) {
  return `
<tr><td style="padding:0 0 10px">
 <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid ${C.line};border-left:4px solid ${C.policy};border-radius:8px">
  <tr><td style="padding:12px 16px">
   <div style="font-size:15px;font-weight:600;color:${C.ink};line-height:1.35">${esc(i.headline)} ${flags(i)}</div>
   <div style="font-size:13px;color:${C.ink};line-height:1.5;margin:6px 0">${esc(i.note)}</div>
   <div style="font-size:12px;color:${C.muted};font-style:italic;margin-bottom:6px">“${esc(i.evidence)}”</div>
   <div style="font-size:12px">${sourceLine(i)}</div>
  </td></tr>
 </table>
</td></tr>`;
}

function section(title: string, color: string, rows: string) {
  return `<tr><td style="padding:22px 0 10px;font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${color}">${title}</td></tr>${rows}`;
}

export function renderEmailSubject(d: Digest): string {
  const prefix = d.demo ? "[DEMO] " : "";
  if (d.quiet) return `${prefix}CSR Radar — week of ${fmtDate(d.generatedAt)}: no strong signals`;
  return `${prefix}CSR Radar — ${d.call.length} to call, ${d.watch.length} to watch (week of ${fmtDate(d.generatedAt)})`;
}

export function renderEmailHtml(d: Digest): string {
  const base = baseUrl();
  const header = `
<tr><td style="padding:26px 0 6px">
  <div style="font-size:12px;color:${C.muted};letter-spacing:.08em;text-transform:uppercase">CSR Partnership Radar${d.demo ? " · DEMO" : ""}</div>
  <div style="font-size:24px;font-weight:800;color:${C.ink};margin:4px 0 10px">Week of ${fmtDate(d.generatedAt)}</div>
  <div style="font-size:14px;color:${C.ink}">🟢 Call <b>${d.call.length}</b> &nbsp;·&nbsp; 🟡 Watch <b>${d.watch.length}</b> &nbsp;·&nbsp; 🏛 Policy <b>${d.policy.length}</b></div>
  <div style="font-size:12px;color:${C.muted};margin-top:4px">Scanned ${d.stats.fetched} articles from ${d.stats.sources} sources · ${fmtDate(d.windowStart)} – ${fmtDate(d.windowEnd)}</div>
</td></tr>
<tr><td style="padding:14px 16px;background:#fff;border:1px solid ${C.line};border-radius:8px;font-size:14px;line-height:1.55;color:${C.ink}">${esc(d.week_summary)}</td></tr>`;

  let body = "";
  if (d.quiet) {
    body = `<tr><td style="padding:22px 0;font-size:14px;color:${C.ink};line-height:1.6">No strong signals this week. The radar scanned ${d.stats.fetched} articles from ${d.stats.sources} sources and found nothing in your sectors that clears the WATCH bar. Nothing to action — enjoy the head start on your outreach list.</td></tr>`;
  } else {
    if (d.call.length) body += section("🟢 Call this week", C.call, d.call.map((i) => callCard(d, i)).join(""));
    else body += section("🟢 Call this week", C.call, `<tr><td style="font-size:14px;color:${C.muted};padding-bottom:6px">Nothing reached CALL this week.</td></tr>`);
    if (d.watch.length) body += section("🟡 Watch", C.watch, d.watch.map((i) => watchCard(d, i)).join(""));
    if (d.policy.length) body += section("🏛 Policy watch", C.policy, d.policy.map(policyCard).join(""));
  }

  const footer = `
<tr><td style="padding:24px 0 30px;font-size:12px;color:${C.muted};line-height:1.6;border-top:1px solid ${C.line}">
  <a href="${base}/digest/${d.id}#skipped" style="color:${C.muted}">Skipped ${d.skipped.length} items</a> ·
  <a href="${base}/digest/${d.id}" style="color:${C.muted}">Open on dashboard</a> ·
  <a href="${base}/settings" style="color:${C.muted}">Settings</a><br/>
  Generated by Gemini Flash${d.model ? ` (${esc(d.model)})` : ""}; verify before outreach. Every item links to its source and quotes it verbatim.
  This radar never contacts companies — you decide who to call.
</td></tr>`;

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(renderEmailSubject(d))}</title></head>
<body style="margin:0;padding:0;background:${C.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg}"><tr><td align="center" style="padding:0 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px">
${header}${body}${footer}
</table></td></tr></table></body></html>`;
}

export function renderEmailText(d: Digest): string {
  const lines = [`CSR Partnership Radar — week of ${fmtDate(d.generatedAt)}`, d.week_summary, ""];
  const item = (i: DigestItem) =>
    [`* ${i.headline} [${i.verdict}, score ${i.score}]`, `  ${i.context}`, `  Why now: ${i.why_now}`, `  "${i.evidence}"`, `  ${i.url}`, ""].join("\n");
  if (d.call.length) lines.push("CALL THIS WEEK", ...d.call.map(item));
  if (d.watch.length) lines.push("WATCH", ...d.watch.map(item));
  if (d.policy.length) lines.push("POLICY WATCH", ...d.policy.map((p) => `* ${p.headline}\n  ${p.note}\n  ${p.url}\n`));
  if (d.quiet) lines.push(`No strong signals this week (scanned ${d.stats.fetched} articles from ${d.stats.sources} sources).`);
  lines.push(`Dashboard: ${baseUrl()}/digest/${d.id}`, "Generated by Gemini Flash; verify before outreach.");
  return lines.join("\n");
}
