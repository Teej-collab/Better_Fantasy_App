"use client";

import { useId, useState, type CSSProperties, type ReactNode } from "react";
import { teamGlow, type ScoringHit } from "@/lib/scoringHighlights";

// A Lounge camera tile's honeycomb frame (2026-10-18 "Scoring
// highlights" mockups), the web twin of mobile/src/components/lounge/
// HexFrame.tsx: a ring of the app's charcoal hex plates with light
// behind them that only shows through the seams. At rest the light is a
// faint grey; when someone's score moves (lib/scoringHighlights.ts), it
// turns the colors of the NFL team that did it, with the points on a
// frosted chip and the play beside their name.

// The app's green, for a team we don't know (the accent itself can be a
// CSS variable, which an SVG stop or an alpha suffix can't use).
const FALLBACK = "#39ff14";

export function HexFrame({ hit, children, style }: { hit: ScoringHit | undefined; children: ReactNode; style?: CSSProperties }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  // The last hit's colors stay while the light fades back out.
  const [last, setLast] = useState(hit);
  if (hit && hit !== last) setLast(hit);
  const shown = hit ?? last;
  const [c1, c2] = teamGlow(shown?.team ?? null, FALLBACK);
  const loss = !!hit && hit.points < 0;
  const lit = !!hit && !loss;

  return (
    <div
      className="relative overflow-hidden rounded-[14px]"
      style={{
        background: "#07080b",
        boxShadow: lit
          ? `0 0 0 1px ${c1}8c, 0 0 22px ${c1}99, 0 0 48px ${c2}38`
          : loss
            ? "0 0 0 1px rgba(248,113,113,0.25), 0 0 18px rgba(220,38,38,0.18)"
            : "0 0 0 1px rgba(255,255,255,0.05)",
        transition: "box-shadow 700ms ease",
        ...style,
      }}
    >
      <div className="absolute inset-0" style={{ background: "radial-gradient(110% 80% at 50% 0%, rgba(150,160,182,0.2) 0%, rgba(150,160,182,0) 72%)" }} />
      <div
        className="absolute inset-0"
        style={{
          opacity: hit ? (loss ? 0.4 : 1) : 0,
          transition: "opacity 700ms ease",
          background: `radial-gradient(90% 75% at 8% 0%, ${c1} 0%, rgba(0,0,0,0) 72%), radial-gradient(90% 75% at 92% 100%, ${c2} 0%, rgba(0,0,0,0) 72%), linear-gradient(135deg, ${c1} 0%, ${c2} 100%)`,
        }}
      />
      <svg className="absolute inset-0 h-full w-full" aria-hidden="true">
        <defs>
          <radialGradient id={`plate${id}`} cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor="#17171c" stopOpacity="1" />
            <stop offset="0.6" stopColor="#121216" stopOpacity="1" />
            <stop offset="0.82" stopColor="#0e0e11" stopOpacity="0.88" />
            <stop offset="0.94" stopColor="#0b0b0d" stopOpacity="0.55" />
            <stop offset="1" stopColor="#0a0a0c" stopOpacity="0.25" />
          </radialGradient>
          <linearGradient id={`sheen${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.08" />
            <stop offset="0.45" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
          {/* Flat-top plates, one tile period (3r × √3·r, r = 7). */}
          <pattern id={`plates${id}`} width="21" height="12.124" patternUnits="userSpaceOnUse" patternTransform="scale(0.95)">
            <polygon points="6.19,0 3.095,5.36 -3.095,5.36 -6.19,0 -3.095,-5.36 3.095,-5.36" fill={`url(#plate${id})`} />
            <polygon points="6.19,12.124 3.095,17.484 -3.095,17.484 -6.19,12.124 -3.095,6.764 3.095,6.764" fill={`url(#plate${id})`} />
            <polygon points="27.19,0 24.095,5.36 17.905,5.36 14.81,0 17.905,-5.36 24.095,-5.36" fill={`url(#plate${id})`} />
            <polygon points="27.19,12.124 24.095,17.484 17.905,17.484 14.81,12.124 17.905,6.764 24.095,6.764" fill={`url(#plate${id})`} />
            <polygon points="16.69,6.062 13.595,11.422 7.405,11.422 4.31,6.062 7.405,0.702 13.595,0.702" fill={`url(#plate${id})`} />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#plates${id})`} />
        <rect width="100%" height="100%" fill={`url(#sheen${id})`} />
      </svg>

      <div
        className="absolute overflow-hidden rounded-[9px] bg-[#0c0e13]"
        style={{ inset: 8, boxShadow: "0 0 0 1px rgba(0,0,0,0.9), 0 0 0 2px rgba(255,255,255,0.06)" }}
      >
        {children}
        <div
          className="pointer-events-none absolute top-1.5 right-1.5 flex h-6 items-center gap-1.5 rounded-[7px] border pr-2 pl-[5px] backdrop-blur-md"
          style={{
            background: "rgba(8,10,14,0.74)",
            borderColor: loss ? "rgba(248,113,113,0.55)" : `${c1}cc`,
            opacity: hit ? 1 : 0,
            transition: "opacity 500ms ease",
          }}
        >
          <span className="h-[13px] w-1 rounded-sm" style={{ background: `linear-gradient(${c1} 0%, ${c1} 50%, ${c2} 50%, ${c2} 100%)` }} />
          <span className="font-mono text-sm font-bold tracking-tight" style={{ color: loss ? "#ff8a9a" : "#fff" }}>
            {shown ? `${shown.points >= 0 ? "+" : "−"}${Math.abs(shown.points).toFixed(1)}` : ""}
          </span>
        </div>
        <span
          className="font-display pointer-events-none absolute right-2 bottom-2 max-w-[55%] truncate text-[11px] font-semibold tracking-[0.9px] text-white uppercase"
          style={{ textShadow: `0 0 10px ${c1}, 0 1px 2px rgba(0,0,0,0.9)`, opacity: hit ? 1 : 0, transition: "opacity 500ms ease" }}
        >
          {shown?.play ?? ""}
        </span>
      </div>
    </div>
  );
}
