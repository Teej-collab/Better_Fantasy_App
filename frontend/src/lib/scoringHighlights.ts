"use client";

import { useEffect, useState } from "react";

import { NFL_TEAM_COLORS } from "@/lib/nfl-teams";
import type { WeekMatchupContextItem } from "@/lib/api";

// The Lounge's scoring highlights (2026-10-18 "Scoring highlights"
// mockups): when someone's starters gain or lose points, their camera
// tile's honeycomb frame lights up in the colors of the NFL team that
// did it, for everyone in the room, instead of a chat message. Worked
// out on each device from the league's own numbers (the matchup context
// every room already polls, on the TV's delay), so every viewer sees
// the same thing without anything new on the server. Mirrors
// mobile/src/lib/scoringHighlights.ts.

/** Gains (or losses) smaller than this between refreshes stay quiet. */
export const HIGHLIGHT_MIN_POINTS = 1;
/** How long a tile stays lit. */
export const HIGHLIGHT_MS = 8000;

// Each team's second color, beside NFL_TEAM_COLORS' first. Where the
// official one is black or near it, the next one that shows on a dark
// screen.
const NFL_TEAM_SECONDARY: Record<string, string> = {
  ARI: "#FFB612",
  ATL: "#A5ACAF",
  BAL: "#241773",
  BUF: "#C60C30",
  CAR: "#BFC0BF",
  CHI: "#0B162A",
  CIN: "#FFFFFF",
  CLE: "#311D00",
  DAL: "#041E42",
  DEN: "#0A2343",
  DET: "#B0B7BC",
  GB: "#FFB612",
  HOU: "#03202F",
  IND: "#A2AAAD",
  JAX: "#D7A22A",
  KC: "#FFB81C",
  LAC: "#FFC20E",
  LAR: "#FFA300",
  LV: "#FFFFFF",
  MIA: "#FC4C02",
  MIN: "#FFC62F",
  NE: "#002244",
  NO: "#FFFFFF",
  NYG: "#A71930",
  NYJ: "#FFFFFF",
  PHI: "#A5ACAF",
  PIT: "#FFFFFF",
  SEA: "#002244",
  SF: "#B3995D",
  TB: "#FF7900",
  TEN: "#0C2340",
  WSH: "#FFB612",
};

/** Raised until it reads as light on the dark plates (navy, brown and
 *  black would vanish otherwise). */
function lift(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const brightness = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const target = 0.34;
  if (brightness >= target) return hex;
  const t = (target - brightness) / (1 - brightness);
  const up = (v: number) => Math.round(v + (255 - v) * t);
  return `#${[up(r), up(g), up(b)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** A team's two glow colors; the app's green for a team it doesn't know. */
export function teamGlow(team: string | null, fallback: string): [string, string] {
  const first = team ? NFL_TEAM_COLORS[team] : undefined;
  if (!first) return [fallback, fallback];
  return [lift(first), lift(NFL_TEAM_SECONDARY[team!] ?? first)];
}

export type ScoringHit = {
  points: number;
  // The NFL team of the starter who moved the score most.
  team: string | null;
  // "Allen · TD", "St. Brown · +3.4".
  play: string;
  at: number;
};

type Snapshot = Map<string, { points: number; tds: number; name: string; team: string | null; owner: string }>;

const BENCH = new Set(["BE", "IR"]);

function touchdowns(stats: Record<string, number> | null): number {
  if (!stats) return 0;
  return Object.entries(stats).reduce((n, [k, v]) => (k.endsWith("_td") ? n + (Number(v) || 0) : n), 0);
}

function lastName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 && /^(jr|sr|ii|iii|iv)\.?$/i.test(parts[parts.length - 1]) ? parts[parts.length - 2] : parts[parts.length - 1];
}

function snapshot(league: WeekMatchupContextItem[]): Snapshot {
  const snap: Snapshot = new Map();
  for (const m of league) {
    for (const side of [m.home, m.away]) {
      for (const p of side.roster) {
        if (p.player_id === null || BENCH.has(p.lineup_slot ?? "")) continue;
        snap.set(`${side.owner_id}:${p.player_id}`, {
          points: p.points_scored ?? 0,
          tds: touchdowns(p.raw_stats),
          name: p.player_name,
          team: p.pro_team,
          owner: String(side.owner_id),
        });
      }
    }
  }
  return snap;
}

/**
 * Who in the league just gained or lost points, by owner_id: compared
 * each time `league` refreshes (the first load only sets the baseline;
 * `key`, the week, resets it). Each hit lasts HIGHLIGHT_MS.
 */
export function useScoringHighlights(league: WeekMatchupContextItem[], key: string | null): Record<string, ScoringHit> {
  const [seen, setSeen] = useState<{ key: string | null; sig: string; snap: Snapshot; hits: Record<string, ScoringHit> }>({
    key: null,
    sig: "",
    snap: new Map(),
    hits: {},
  });
  const snap = snapshot(league);
  const sig = `${key}|${[...snap].map(([id, v]) => `${id}:${v.points}:${v.tds}`).join(",")}`;
  if (key !== null && league.length > 0 && sig !== seen.sig) {
    const hits = { ...seen.hits };
    if (seen.key === key) {
      const at = new Date().getTime();
      // Per owner: the total change, and the starter behind most of it.
      const byOwner = new Map<string, { total: number; top: { gained: number; name: string; team: string | null; td: boolean } | null }>();
      for (const [id, now] of snap) {
        const before = seen.snap.get(id);
        if (!before) continue;
        const gained = now.points - before.points;
        if (Math.abs(gained) < 0.05) continue;
        const entry = byOwner.get(now.owner) ?? { total: 0, top: null };
        entry.total += gained;
        if (!entry.top || Math.abs(gained) > Math.abs(entry.top.gained)) {
          entry.top = { gained, name: now.name, team: now.team, td: now.tds > before.tds };
        }
        byOwner.set(now.owner, entry);
      }
      for (const [owner, { total, top }] of byOwner) {
        if (!top || Math.abs(total) < HIGHLIGHT_MIN_POINTS) continue;
        const what = top.td ? "TD" : `${top.gained > 0 ? "+" : "−"}${Math.abs(top.gained).toFixed(1)}`;
        hits[owner] = { points: total, team: top.team, play: `${lastName(top.name)} · ${what}`, at };
      }
    }
    setSeen({ key, sig, snap, hits });
  }

  // Drop each hit once it has had its time.
  const hits = seen.hits;
  useEffect(() => {
    const ats = Object.values(hits).map((h) => h.at);
    if (ats.length === 0) return;
    const wait = Math.max(0, Math.min(...ats) + HIGHLIGHT_MS - Date.now());
    const timer = setTimeout(() => {
      const now = Date.now();
      setSeen((prev) => ({
        ...prev,
        hits: Object.fromEntries(Object.entries(prev.hits).filter(([, h]) => now - h.at < HIGHLIGHT_MS)),
      }));
    }, wait + 50);
    return () => clearTimeout(timer);
  }, [hits]);
  return hits;
}
