"use client";

import { useState, type ReactNode } from "react";
import type { NflGame } from "@/lib/api";

// Weather Watch's living panes (Niko's idea, 2026-10-29 "Weather Watch ·
// animated" mockup; the app's twin is mobile/src/components/living/
// WeatherFx.tsx): each game's row sits on its own weather. Rain speckles
// the glass (Niko: drops hitting the screen, not falling lines) and
// storms flash with lightning too (click one to make it strike); snow
// falls with frost in the corners, from a few flurries up to a sideways
// blizzard; and wind blows swirls across, over any of the others too
// (click for a gust). The motion is all CSS (.wx-* in globals.css), off
// under prefers-reduced-motion.

type Weather = NonNullable<NflGame["weather"]>;
export type WeatherKind = "storm" | "snow" | "rain" | "wind" | "cold";

// Wind that changes a game: kickers miss, teams run more. 15 mph
// sustained or 25 mph gusts.
export function windy(w: Weather): boolean {
  return (w.wind_mph ?? 0) >= 15 || (w.wind_gust_mph ?? 0) >= 25;
}

export function weatherKind(w: Weather): WeatherKind {
  const c = w.condition?.toLowerCase() ?? "";
  if (/thunder|storm|lightning/.test(c)) return "storm";
  if (/snow|sleet|flurr|ice|wintry/.test(c)) return "snow";
  if (/rain|shower|drizzle/.test(c)) return "rain";
  if (windy(w) || /wind/.test(c)) return "wind";
  return "cold";
}

export type SnowLevel = "flurries" | "snow" | "blizzard";

export function snowLevel(w: Weather): SnowLevel {
  const c = w.condition?.toLowerCase() ?? "";
  if (/blizzard|heavy snow/.test(c) || (w.wind_mph ?? 0) >= 20 || (w.wind_gust_mph ?? 0) >= 35) return "blizzard";
  if (/flurr|light snow|snow shower/.test(c)) return "flurries";
  return "snow";
}

/** What the pane calls the weather: ESPN's words, except "Windy" when the
 *  wind is the story (ESPN would say "Partly cloudy") and "Blizzard" for
 *  snow in a gale. */
export function weatherLabel(w: Weather): string | null {
  const kind = weatherKind(w);
  if (kind === "wind") return "Windy";
  if (kind === "snow" && snowLevel(w) === "blizzard") return "Blizzard";
  return w.condition;
}

// "Wind 14 mph, gusts 23" from 10 mph up; gusts only when clearly stronger.
export function windLine(w: Weather): string | null {
  if ((w.wind_mph ?? 0) < 10) return null;
  return `Wind ${w.wind_mph} mph${(w.wind_gust_mph ?? 0) > (w.wind_mph ?? 0) + 5 ? `, gusts ${w.wind_gust_mph}` : ""}`;
}

// Fixed spots so a pane looks the same on every render.
const SNOW = { flurries: { count: 9, base: 4.6, step: 0.8 }, snow: { count: 18, base: 3.2, step: 0.6 }, blizzard: { count: 40, base: 0.9, step: 0.25 } } as const;
const flakes = (level: SnowLevel) =>
  Array.from({ length: SNOW[level].count }, (_, i) => ({
    left: `${(i * 37 + 9) % 100}%`,
    top: `${(i * 23) % 100}%`,
    size: 2 + (i % (level === "blizzard" ? 4 : 3)),
    duration: `${(SNOW[level].base + (i % 5) * SNOW[level].step).toFixed(2)}s`,
    delay: `${-((i * 0.71) % 4)}s`,
  }));
const specks = (count: number, duration: number) =>
  Array.from({ length: count }, (_, i) => ({
    left: `${(i * 47 + 9) % 97}%`,
    top: `${(i * 31 + 5) % 90}%`,
    size: 3 + ((i * 7) % 5),
    duration: `${duration}s`,
    delay: `${((i * 0.29) % 1) * duration}s`,
  }));
const STORM_SPECKS = specks(26, 1.1);
const RAIN_SPECKS = specks(14, 1.8);
const BEADS = Array.from({ length: 10 }, (_, i) => ({
  left: `${((i * 53 + 17) % 92) + 2}%`,
  top: `${((i * 29 + 11) % 55) + 6}%`,
  duration: `${3.2 + (i % 4) * 0.5}s`,
  delay: `${((i * 0.37) % 4).toFixed(2)}s`,
}));
const SWIRLS = [
  "M-20 34 C60 18 120 46 190 30 S300 12 330 26 C350 36 335 52 318 46",
  "M-20 74 C70 62 140 88 230 70 S340 58 420 70",
  "M-20 100 C80 92 150 108 210 98 C250 92 265 78 250 72 C238 68 228 76 238 82",
];

/** A game's row on its weather. */
export function WeatherPane({ weather, label, children }: { weather: Weather; label: string; children: ReactNode }) {
  const kind = weatherKind(weather);
  const blowing = windy(weather);
  const level = kind === "snow" ? snowLevel(weather) : null;
  // Bumped by a click: remounts the effect so it plays from the start.
  const [poke, setPoke] = useState(0);
  const [active, setActive] = useState(false);
  const interactive = kind === "storm" || blowing;

  const fx = (
    <span key={poke} className="wx-fx" aria-hidden="true">
      {kind === "storm" && <span className="wx-cloud" />}
      {(kind === "storm" ? STORM_SPECKS : kind === "rain" ? RAIN_SPECKS : []).map((d, i) => (
        <i key={i} className="wx-speck" style={{ left: d.left, top: d.top, width: d.size, height: d.size, animationDuration: d.duration, animationDelay: d.delay }} />
      ))}
      {kind === "rain" && BEADS.map((b, i) => <i key={i} className="wx-bead" style={{ left: b.left, top: b.top, animationDuration: b.duration, animationDelay: b.delay }} />)}
      {(kind === "snow" || kind === "cold") && <span className="wx-frost" />}
      {level === "blizzard" && <span className="wx-whiteout" />}
      {level &&
        flakes(level).map((f, i) => (
          <i
            key={i}
            className={level === "blizzard" ? "wx-bflake" : "wx-flake"}
            style={{ left: level === "blizzard" ? `calc(${f.left} - 120px)` : f.left, top: level === "blizzard" ? f.top : undefined, width: f.size, height: f.size, animationDuration: f.duration, animationDelay: f.delay }}
          />
        ))}
      {(blowing || level === "blizzard") && (
        <svg className={`wx-wind${kind === "snow" ? " wx-wind-white" : ""}`} viewBox="0 0 390 120" preserveAspectRatio="none">
          {SWIRLS.map((d, i) => (
            <path key={i} d={d} style={{ animationDelay: `${active ? i * 0.25 : i * 0.87}s` }} />
          ))}
        </svg>
      )}
      {kind === "storm" && (
        <>
          <span className="wx-flash" />
          <svg className="wx-bolt" viewBox="0 0 40 90">
            <path d="M24 0 L8 40 L20 40 L10 90 L34 32 L21 32 L30 0 Z" fill="#f2efff" />
          </svg>
          <span className="wx-edge" />
        </>
      )}
    </span>
  );

  const className = `wx-pane wx-k-${kind}${active ? " wx-poked" : ""}`;
  if (!interactive) {
    return (
      <div className={className}>
        {fx}
        <div className="wx-content">{children}</div>
      </div>
    );
  }
  return (
    <button
      type="button"
      className={className}
      aria-label={`${label}. ${kind === "storm" ? "Plays a lightning strike" : "Plays a gust of wind"}`}
      onClick={() => {
        setPoke((n) => n + 1);
        setActive(true);
        window.setTimeout(() => setActive(false), kind === "storm" ? 950 : 2300);
      }}
    >
      {fx}
      <span className="wx-content">{children}</span>
    </button>
  );
}
