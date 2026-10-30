"use client";

import { useState } from "react";

import type { WeekMatchupContextItem } from "@/lib/api";

// Every starter in the league, every refresh (2026-10-29: moments beyond
// the game on the TV). Comparing each refresh of the week's matchups to
// the last picks out a touchdown or a big jump for anyone's starter in
// any game, who it's for and who it's against, and how far it moved that
// owner's chance to win; it also lists who's in the red zone right now.
// Mirrors mobile/src/lib/leagueMoments.ts.

export const ELSEWHERE_MIN_POINTS = 5;
export const BIG_SWING = 10;

export type LeagueMoment = {
  id: string;
  playerName: string;
  proTeam: string | null;
  points: number;
  touchdown: boolean;
  ownerId: string;
  ownerName: string;
  againstId: string;
  againstName: string;
  // The owner's chance to win, before and after (0–100), when known.
  winBefore: number | null;
  winAfter: number | null;
  at: number;
};

export type RedZone = { playerName: string; proTeam: string | null; ownerId: string };

type Snap = {
  points: number;
  tds: number;
  name: string;
  team: string | null;
  owner: string;
  ownerName: string;
  against: string;
  againstName: string;
  win: number | null;
};

const BENCH = new Set(["BE", "IR"]);

function touchdowns(stats: Record<string, number> | null): number {
  if (!stats) return 0;
  return Object.entries(stats).reduce((n, [k, v]) => (k.endsWith("_td") ? n + (Number(v) || 0) : n), 0);
}

function snapshot(league: WeekMatchupContextItem[]): Map<string, Snap> {
  const snap = new Map<string, Snap>();
  for (const m of league) {
    for (const [side, other] of [
      [m.home, m.away],
      [m.away, m.home],
    ] as const) {
      for (const p of side.roster) {
        if (p.player_id === null || BENCH.has(p.lineup_slot ?? "")) continue;
        snap.set(`${m.matchup_id}:${side.owner_id}:${p.player_id}`, {
          points: p.points_scored ?? 0,
          tds: touchdowns(p.raw_stats),
          name: p.player_name,
          team: p.pro_team,
          owner: String(side.owner_id),
          ownerName: side.owner_name,
          against: String(other.owner_id),
          againstName: other.owner_name,
          win: side.win_probability ?? null,
        });
      }
    }
  }
  return snap;
}

/** Who's inside the 20 right now, in a game that's on. */
export function redZoneNow(league: WeekMatchupContextItem[]): RedZone[] {
  const out: RedZone[] = [];
  for (const m of league) {
    for (const side of [m.home, m.away]) {
      for (const p of side.roster) {
        if (BENCH.has(p.lineup_slot ?? "") || !p.is_redzone || p.game_status !== "in_progress") continue;
        out.push({ playerName: p.player_name, proTeam: p.pro_team, ownerId: String(side.owner_id) });
      }
    }
  }
  return out;
}

/** New moments as the league refreshes; the first load (and a new week,
 *  `key`) only sets the baseline. */
export function useLeagueMoments(league: WeekMatchupContextItem[], key: string | null): LeagueMoment[] {
  const [seen, setSeen] = useState<{ key: string | null; sig: string; snap: Map<string, Snap>; moments: LeagueMoment[] }>({
    key: null,
    sig: "",
    snap: new Map(),
    moments: [],
  });
  if (key === null || league.length === 0) return seen.moments;
  const snap = snapshot(league);
  const sig = `${key}|${[...snap].map(([id, v]) => `${id}:${v.points}:${v.tds}:${v.win}`).join(",")}`;
  if (sig !== seen.sig) {
    const found: LeagueMoment[] = [];
    if (seen.key === key) {
      const at = new Date().getTime();
      for (const [id, now] of snap) {
        const before = seen.snap.get(id);
        if (!before) continue;
        const gained = now.points - before.points;
        const touchdown = now.tds > before.tds;
        const swing = now.win !== null && before.win !== null ? Math.abs(now.win - before.win) : 0;
        if (!touchdown && gained < ELSEWHERE_MIN_POINTS && !(swing >= BIG_SWING && Math.abs(gained) >= 1)) continue;
        found.push({
          id: `${id}-${at}`,
          playerName: now.name,
          proTeam: now.team,
          points: gained,
          touchdown,
          ownerId: now.owner,
          ownerName: now.ownerName,
          againstId: now.against,
          againstName: now.againstName,
          winBefore: before.win,
          winAfter: now.win,
          at,
        });
      }
    }
    setSeen({ key, sig, snap, moments: found.length ? [...seen.moments, ...found].slice(-40) : seen.moments });
  }
  return seen.moments;
}
