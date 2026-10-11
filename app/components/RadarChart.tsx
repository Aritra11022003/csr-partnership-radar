"use client";
import { useState } from "react";
import type { DigestItem } from "@/lib/types";

/**
 * The digest as a radar: one blip per opportunity.
 *  angle    → sector wedge (policy items get their own wedge)
 *  distance → score (closer to the centre = stronger; inner ring = CALL threshold)
 *  colour   → verdict
 */
const SIZE = 340;
const C = SIZE / 2;
const R = 150;
const PAD = 46;
const short = (w: string) => (w.length > 11 ? w.split(" ")[0] : w);
const COLORS = { CALL: "#4fd08f", WATCH: "#f6c552", POLICY: "#a99bff" };

function hash(s: string) {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0) / 4294967295;
}

export function RadarChart({ items, callThreshold = 65, watchThreshold = 40 }: { items: (DigestItem & { note?: string })[]; callThreshold?: number; watchThreshold?: number }) {
  const [hover, setHover] = useState<string | null>(null);
  const wedges = [...new Set(items.map((i) => (i.signal === "POLICY" ? "Policy" : i.sector ?? "Other")))];
  if (!wedges.length) wedges.push("Education", "Skill Development", "Digital Literacy", "Youth Employment");
  const span = (2 * Math.PI) / wedges.length;
  const rFor = (score: number) => R * Math.min(0.95, Math.max(0.08, 1 - score / 100));
  const blips = items.map((i) => {
    const w = wedges.indexOf(i.signal === "POLICY" ? "Policy" : i.sector ?? "Other");
    const jitter = 0.18 + hash(i.id) * 0.64;
    const a = -Math.PI / 2 + span * (w + jitter);
    const score = i.signal === "POLICY" ? 50 : i.score;
    const r = rFor(score) + (hash(`${i.id}r`) - 0.5) * 8;
    const kind = i.signal === "POLICY" ? "POLICY" : i.verdict === "CALL" ? "CALL" : "WATCH";
    return { i, x: C + r * Math.cos(a), y: C + r * Math.sin(a), kind: kind as keyof typeof COLORS };
  });
  const hovered = blips.find((b) => b.i.id === hover);

  return (
    <figure className="radar-fig" aria-label={`Radar of ${items.length} opportunities by sector and score`}>
      <svg viewBox={`${-PAD} ${-PAD / 2} ${SIZE + 2 * PAD} ${SIZE + PAD}`} width="100%" role="img">
        <defs>
          <radialGradient id="rg" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(79,208,143,0.18)" />
            <stop offset="100%" stopColor="rgba(79,208,143,0.02)" />
          </radialGradient>
          <linearGradient id="sweep" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgba(79,208,143,0)" />
            <stop offset="100%" stopColor="rgba(79,208,143,0.38)" />
          </linearGradient>
        </defs>
        <circle cx={C} cy={C} r={R} fill="url(#rg)" stroke="rgba(255,255,255,0.14)" />
        {/* threshold rings */}
        <circle cx={C} cy={C} r={rFor(callThreshold)} fill="rgba(79,208,143,0.08)" stroke="rgba(79,208,143,0.55)" strokeDasharray="3 4" />
        <circle cx={C} cy={C} r={rFor(watchThreshold)} fill="none" stroke="rgba(246,197,82,0.4)" strokeDasharray="3 4" />
        <circle cx={C} cy={C} r={R * 0.92} fill="none" stroke="rgba(255,255,255,0.06)" />
        <text x={C + 4} y={C - rFor(callThreshold) + 12} className="radar-ring-lbl" fill="rgba(99,224,161,0.9)">CALL</text>
        <text x={C + 4} y={C - rFor(watchThreshold) + 12} className="radar-ring-lbl" fill="rgba(246,197,82,0.85)">WATCH</text>
        {/* wedges */}
        {wedges.map((w, k) => {
          const a = -Math.PI / 2 + span * k;
          const mid = a + span / 2;
          const lx = C + (R + 4) * Math.cos(mid);
          const ly = C + (R + 4) * Math.sin(mid);
          return (
            <g key={w}>
              <line x1={C} y1={C} x2={C + R * Math.cos(a)} y2={C + R * Math.sin(a)} stroke="rgba(255,255,255,0.1)" />
              <text x={lx} y={ly} textAnchor={Math.cos(mid) > 0.2 ? "start" : Math.cos(mid) < -0.2 ? "end" : "middle"} dominantBaseline={Math.sin(mid) > 0.2 ? "hanging" : Math.sin(mid) < -0.2 ? "auto" : "middle"} className="radar-lbl">
                {short(w)}
              </text>
            </g>
          );
        })}
        {/* sweep */}
        <g className="radar-sweep" style={{ transformOrigin: `${C}px ${C}px` }}>
          <path d={`M ${C} ${C} L ${C + R} ${C} A ${R} ${R} 0 0 0 ${C + R * Math.cos(-0.55)} ${C + R * Math.sin(-0.55)} Z`} fill="url(#sweep)" />
          <line x1={C} y1={C} x2={C + R} y2={C} stroke="rgba(79,208,143,0.7)" strokeWidth="1.5" />
        </g>
        <circle cx={C} cy={C} r="3" fill="#4fd08f" />
        {/* blips */}
        {blips.map((b) => (
          <g
            key={b.i.id}
            className={`blip ${b.kind === "CALL" ? "blip-call" : ""}`}
            onMouseEnter={() => setHover(b.i.id)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(b.i.id)}
            onBlur={() => setHover(null)}
            onClick={() => document.getElementById(`item-${b.i.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}
            tabIndex={0}
            role="button"
            aria-label={`${b.i.headline} — ${b.kind}, score ${b.i.score}`}
          >
            {b.kind === "CALL" && <circle cx={b.x} cy={b.y} r="11" fill={COLORS.CALL} className="blip-pulse" />}
            <circle cx={b.x} cy={b.y} r={hover === b.i.id ? 8 : 6} fill={COLORS[b.kind]} stroke="#0d1430" strokeWidth="2" />
          </g>
        ))}
      </svg>
      <figcaption className="radar-cap">
        {hovered ? (
          <span><b style={{ color: COLORS[hovered.kind] }}>{hovered.kind}</b> · {hovered.i.headline}</span>
        ) : (
          <span>
            <i style={{ background: COLORS.CALL }} /> Call <i style={{ background: COLORS.WATCH }} /> Watch <i style={{ background: COLORS.POLICY }} /> Policy · closer to centre = stronger
          </span>
        )}
      </figcaption>
    </figure>
  );
}
