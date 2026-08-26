"use client";

import { useEffect, useState } from "react";
import { getMyTeam, type RosterEntry } from "@/lib/api";
import type { LiveGame } from "@/lib/gamecastApi";
import { SECTION_COLORS, panelGlowStyle } from "@/lib/sectionColors";

const MAX_PLAYERS = 6;

/**
 * "Who from this game is on my team" — the one section that's
 * genuinely The Weekend's own, not an ESPN Gamecast clone. Deliberately
 * does NOT compute or show a fantasy point value here: this app has no
 * scoring-rules engine of its own yet (see the project plan's Phase D —
 * current_rosters has no live points until that lands), and inventing
 * one here would be exactly the "second independent scoring system"
 * this feature was told not to build. Instead: real players mentioned
 * in recent plays, cross-referenced by name against the signed-in
 * owner's own roster (no shared player-ID space between this app's
 * Sleeper-sourced roster and whatever provider Gamecast's play data
 * comes from, so name matching — case-insensitive — is the only link
 * available) and flagged as "YOUR TEAM". Everyone else just shows the
 * play they were involved in, honestly, with no fabricated number
 * attached.
 */
export function FantasyImpact({ game, isSignedIn }: { game: LiveGame; isSignedIn: boolean }) {
  const [roster, setRoster] = useState<RosterEntry[] | null>(null);

  useEffect(() => {
    if (!isSignedIn) return;
    let cancelled = false;
    getMyTeam()
      .then((team) => {
        if (!cancelled) setRoster(team.roster);
      })
      .catch(() => {
        if (!cancelled) setRoster(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isSignedIn]);

  const involved = new Map<string, { name: string; teamAbbr: string; latestPlay: string }>();
  for (const play of game.plays) {
    for (const p of play.players_involved) {
      if (!involved.has(p.name)) {
        involved.set(p.name, { name: p.name, teamAbbr: p.team_abbr, latestPlay: play.description });
      }
    }
    if (involved.size >= MAX_PLAYERS) break;
  }

  if (involved.size === 0) {
    return (
      <div className="neon-panel flex flex-col gap-2 rounded-xl p-4 sm:p-5" style={panelGlowStyle(SECTION_COLORS.league)}>
        <h2 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">Fantasy Impact</h2>
        <p className="text-sm text-black/50 dark:text-white/50">No player activity to show yet.</p>
      </div>
    );
  }

  return (
    <div className="neon-panel flex flex-col gap-3 rounded-xl p-4 sm:p-5" style={panelGlowStyle(SECTION_COLORS.league)}>
      <h2 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">Fantasy Impact</h2>
      <ul className="flex flex-col gap-2">
        {[...involved.values()].map((p) => {
          const mine = roster?.find((r) => r.player_name.toLowerCase() === p.name.toLowerCase()) ?? null;
          return (
            <li
              key={p.name}
              className={`flex flex-col gap-0.5 rounded-lg px-3 py-2 text-sm ${
                mine ? "bg-[color:var(--wl-accent)]/[0.08] ring-1 ring-[color:var(--wl-accent)]/40" : "bg-black/[0.02] dark:bg-white/[0.03]"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{p.name}</span>
                {mine && (
                  <span className="rounded-full bg-[color:var(--wl-accent)]/15 px-2 py-0.5 text-[10px] font-bold tracking-wide text-[color:var(--wl-accent-dim)] uppercase">
                    Your Team
                  </span>
                )}
              </div>
              <span className="truncate text-xs text-black/50 dark:text-white/50">{p.latestPlay}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
