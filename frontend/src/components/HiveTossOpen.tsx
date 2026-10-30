"use client";

import Image from "next/image";
import { useEffect, useRef, type CSSProperties } from "react";
import { Anton } from "next/font/google";
import { IntroSeasonDecor } from "@/components/IntroSeasonDecor";
import { currentSeason, seasonalEmblem } from "@/lib/seasonal";

const anton = Anton({ weight: "400", subsets: ["latin"] });

// The quick Welcome Back, every visit after the day's full intro
// (2026-10-29 "Hive Toss", Niko's pick: the coin toss's motion with Hive
// Ignite's size and colors). The Hive Mark is flipped up like a coin,
// lands with a ring and sparks, its cells light one by one with the
// orange one last, the real logo (seasonal: the jack-o'-lantern, the ice
// hive) settles over them, "Welcome Back" rises with a light sweep, and
// the page opens through a hexagon growing out of the orange cell
// (`iris`; without it the last frame holds until the caller moves on).
// The orange cell is poured like a glass of beer (.ht-pour: a stream, the
// level rising with bubbles, a rolling foam head). With
// `full` it is also the full intro's finale, landing on the can opening
// after WELCOME / TO / THE, the fill riding the pour sound.
// All CSS (.ht-* in globals.css). The app's twin is
// mobile/src/components/HiveTossOpen.tsx.

export const HIVE_TOSS_MS = 3350;
const IRIS_AT_MS = 2650;
// As the full intro's finale (HomeWelcomeBackEntry, 2026-10-30) the pour
// rides the pour sound and the logo waits until it's poured (.ht-full in
// globals.css moves the pour, logo, Welcome Back and iris to match).
const FULL_HOLD_MS = 2190;
// The poured cell: beer stops short of the rim (78%), foam fills the rest.
const CELL_H = 50.2;
const BEER_H = 78.3;
const FOAM_X = Array.from({ length: 25 }, (_, k) => -72 + k * 6);
const foamPath = (cx: number, cy: number) =>
  `M${cx - 72},${cy - CELL_H + BEER_H + 2} ` +
  FOAM_X.map((x) => `L${cx + x},${(cy - CELL_H - 3 + 2.4 * Math.sin(x / 7) + 1.2 * Math.sin(x / 3.1)).toFixed(1)}`).join(" ") +
  ` L${cx + 72},${cy - CELL_H + BEER_H + 2} Z`;

// The Hive Mark's seven cells in its own 400-unit square (flat-top,
// radius 58), in the order they light; the last is the orange one.
const CELLS: [number, number][] = [
  [200, 89.1],
  [104, 144.6],
  [104, 255.4],
  [200, 310.9],
  [296, 255.4],
  [200, 200],
  [296, 144.6],
];
const hex = (cx: number, cy: number, r = 58) =>
  [
    [cx + r, cy],
    [cx + r / 2, cy + r * 0.866],
    [cx - r / 2, cy + r * 0.866],
    [cx - r, cy],
    [cx - r / 2, cy - r * 0.866],
    [cx + r / 2, cy - r * 0.866],
  ]
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
const SPARKS = [
  [-130, -30],
  [-95, -85],
  [-40, -115],
  [30, -120],
  [95, -85],
  [130, -25],
  [-150, 10],
  [150, 12],
];

export function HiveTossOpen({
  displayName,
  iris,
  full = false,
  onDone,
  onSkip,
}: {
  displayName: string | null;
  iris: boolean;
  full?: boolean;
  onDone: () => void;
  onSkip: () => void;
}) {
  const season = currentSeason();
  const gate = useRef<HTMLDivElement>(null);
  const hive = useRef<HTMLDivElement>(null);
  const tube = (i: number) => (season === "winter" ? "#9fdcff" : season === "halloween" && i % 2 ? "#b44dff" : "#39ff14");
  const lit = season === "winter" ? "#bfeaff" : "#ff7a1a";

  useEffect(() => {
    // Aim the iris at the orange cell, wherever the hive ended up.
    const box = hive.current?.getBoundingClientRect();
    if (box && gate.current) {
      gate.current.style.setProperty("--ox", `${box.left + (296 / 400) * box.width}px`);
      gate.current.style.setProperty("--oy", `${box.top + (144.6 / 400) * box.height}px`);
    }
    const done = window.setTimeout(onDone, (iris ? HIVE_TOSS_MS : IRIS_AT_MS) + (full ? FULL_HOLD_MS : 0));
    return () => window.clearTimeout(done);
    // Mount-only: the open runs on its own clock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={gate} className={`ht-gate${iris ? " ht-iris" : ""}${full ? " ht-full" : ""} ht-${season ?? "standard"}`}>
      <div className="ht-stage" aria-hidden="true">
        <IntroSeasonDecor />
        <div className="ht-center">
          <div className="ht-ground">
            <span className="ht-shadow" />
            <span className="ht-ring" />
            {SPARKS.map(([x, y], i) => (
              <i key={i} className="ht-spark" style={{ "--x": `${x}px`, "--y": `${y}px`, "--c": i % 2 ? "#ff8a2a" : "#39ff14" } as CSSProperties} />
            ))}
          </div>
          <div ref={hive} className="ht-toss">
            <div className="ht-coin">
              <svg className="ht-face ht-back" viewBox="0 0 400 400">
                {CELLS.map(([cx, cy], i) => (
                  <polygon key={i} points={hex(cx, cy)} fill={i === 6 ? lit : "rgba(255,122,26,.12)"} stroke="#ff8a2a" strokeWidth="3" />
                ))}
              </svg>
              <div className="ht-face">
                <svg viewBox="0 0 400 400" className="ht-cells">
                  <defs>
                    <filter id="htGlow" x="-60%" y="-60%" width="220%" height="220%">
                      <feGaussianBlur in="SourceGraphic" stdDeviation="1.2" result="a" />
                      <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="b" />
                      <feGaussianBlur in="SourceGraphic" stdDeviation="10" result="c" />
                      <feMerge>
                        <feMergeNode in="c" />
                        <feMergeNode in="b" />
                        <feMergeNode in="a" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                    <clipPath id="htPourClip">
                      <polygon points={hex(CELLS[6][0], CELLS[6][1])} />
                    </clipPath>
                    <linearGradient id="htPourFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stopColor={season === "winter" ? "#e6f7ff" : "#ffb347"} />
                      <stop offset=".5" stopColor={lit} />
                      <stop offset="1" stopColor={season === "winter" ? "#4fa9e8" : "#b83c00"} />
                    </linearGradient>
                    <linearGradient id="htStream" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stopColor="#ffbe6e" stopOpacity="0" />
                      <stop offset=".35" stopColor={season === "winter" ? "#c9eeff" : "#ffb347"} />
                      <stop offset="1" stopColor={lit} />
                    </linearGradient>
                  </defs>
                  {CELLS.map(([cx, cy], i) => (
                    <g key={i}>
                      <polygon points={hex(cx, cy)} fill={i === 6 ? "rgba(255,122,26,.18)" : "#0b130d"} stroke={i === 6 ? lit : tube(i)} strokeOpacity=".6" strokeWidth="2.5" />
                      {i === 6 && (
                        <>
                          <rect className="ht-stream" x={cx - 3} y={cy - CELL_H - 46} width="6" height={CELL_H * 2 + 46} fill="url(#htStream)" />
                          <g clipPath="url(#htPourClip)">
                            <g className="ht-pour">
                              <rect x={cx - 60} y={cy + CELL_H - BEER_H} width="120" height={BEER_H + 2} fill="url(#htPourFill)" />
                              {[-18, 6, 20, -6, 12].map((dx, k) => (
                                <circle key={k} className="ht-bub" cx={cx + dx} cy={cy + CELL_H - 3} r="1.8" fill="#fff1d6" style={{ animationDelay: `${k * 0.14}s` }} />
                              ))}
                              <g className="ht-foam">
                                <path className="ht-roll" d={foamPath(cx, cy)} fill="#fff3dc" stroke="rgba(255,214,160,.9)" strokeWidth="1.2" />
                              </g>
                            </g>
                          </g>
                        </>
                      )}
                      <g className="ht-cell" style={{ animationDelay: `${i === 6 ? 1.75 : 1.29 + i * 0.07}s` }}>
                        <polygon points={hex(cx, cy)} fill="none" stroke={i === 6 ? lit : tube(i)} strokeWidth="3.2" strokeLinejoin="round" filter="url(#htGlow)" />
                        <polygon points={hex(cx, cy)} fill="none" stroke="#fff" strokeOpacity=".8" strokeWidth="1" strokeLinejoin="round" />
                      </g>
                    </g>
                  ))}
                </svg>
                <Image src={seasonalEmblem()} alt="" width={400} height={400} priority className="ht-logo" />
              </div>
            </div>
          </div>
          <p className={`ht-welcome ${anton.className}`}>
            <span>Welcome Back{displayName ? `, ${displayName}` : ""}</span>
          </p>
        </div>
      </div>
      <p className="sr-only" role="status">
        The Weekend. Welcome Back{displayName ? `, ${displayName}` : ""}
      </p>
      <button onClick={onSkip} className="wl-skip-intro safe-pt safe-px absolute top-0 right-0 z-10 text-xs">
        Skip →
      </button>
    </div>
  );
}
