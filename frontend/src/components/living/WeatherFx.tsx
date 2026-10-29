"use client";

import { useState, type ReactNode } from "react";
import type { NflGame } from "@/lib/api";

// Weather Watch's living panes (Niko's idea, 2026-10-29 "Weather Watch ·
// animated" mockup; the app's twin is mobile/src/components/living/
// WeatherFx.tsx): each game's row sits on its own weather. Storms rain
// and flash with lightning (click one to make it strike), rain beads on
// the glass, snow falls with frost in the corners, and wind blows swirls
// across, over any of the others too (click for a gust). The motion is
// all CSS (.wx-* in globals.css), off under prefers-reduced-motion.

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

// "Wind 14 mph, gusts 23" from 10 mph up; gusts only when clearly stronger.
export function windLine(w: Weather): string | null {
  if ((w.wind_mph ?? 0) < 10) return null;
  return `Wind ${w.wind_mph} mph${(w.wind_gust_mph ?? 0) > (w.wind_mph ?? 0) + 5 ? `, gusts ${w.wind_gust_mph}` : ""}`;
}

// Fixed spots so a pane looks the same on every render.
const FLAKES = Array.from({ length: 18 }, (_, i) => ({
  left: `${(i * 37 + 9) % 100}%`,
  size: 2 + (i % 3),
  duration: `${3.2 + (i % 5) * 0.6}s`,
  delay: `${-((i * 0.71) % 4)}s`,
}));
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
  // Bumped by a click: remounts the effect so it plays from the start.
  const [poke, setPoke] = useState(0);
  const [active, setActive] = useState(false);
  const interactive = kind === "storm" || blowing;

  const fx = (
    <span key={poke} className="wx-fx" aria-hidden="true">
      {kind === "storm" && <span className="wx-cloud" />}
      {(kind === "storm" || kind === "rain") && <span className={`wx-rain${kind === "rain" ? " wx-rain-soft" : ""}`} />}
      {kind === "rain" && BEADS.map((b, i) => <i key={i} className="wx-bead" style={{ left: b.left, top: b.top, animationDuration: b.duration, animationDelay: b.delay }} />)}
      {(kind === "snow" || kind === "cold") && <span className="wx-frost" />}
      {kind === "snow" &&
        FLAKES.map((f, i) => <i key={i} className="wx-flake" style={{ left: f.left, width: f.size, height: f.size, animationDuration: f.duration, animationDelay: f.delay }} />)}
      {blowing && (
        <svg className="wx-wind" viewBox="0 0 390 120" preserveAspectRatio="none">
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
