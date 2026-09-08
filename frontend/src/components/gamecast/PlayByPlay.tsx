"use client";

import { useState } from "react";
import { nflTeamColor } from "@/lib/nfl-teams";
import type { GamecastPlay, LiveGame } from "@/lib/gamecastApi";
import { SECTION_COLORS, panelGlowStyle } from "@/lib/sectionColors";

const EMPHASIZED_EVENTS = new Set(["TOUCHDOWN", "FIELD_GOAL", "TURNOVER", "INTERCEPTION", "FUMBLE"]);

function emphasisFor(play: GamecastPlay): "score" | "turnover" | "big" | null {
  if (play.is_turnover) return "turnover";
  if (play.is_scoring_play || (play.event_type && EMPHASIZED_EVENTS.has(play.event_type))) return "score";
  if (play.yards_gained !== null && play.yards_gained >= 20) return "big";
  return null;
}

const EMPHASIS_STYLE: Record<"score" | "turnover" | "big", string> = {
  score: "border-[color:var(--wl-accent)]/50 bg-[color:var(--wl-accent)]/[0.06]",
  turnover: "border-red-500/50 bg-red-500/[0.06]",
  big: "border-sky-500/40 bg-sky-500/[0.05]",
};

/**
 * Newest play first. Every item carries .gamecast-play-enter — that
 * class only ever animates on the moment a given play_id's <li> is
 * first mounted (React's key-based reconciliation means an existing
 * key is patched in place, never remounted, on a later render with the
 * same list plus one new play at the top), so a plain re-render with
 * no new plays never re-triggers it. No manual "have I seen this play
 * before" bookkeeping needed for that to be true.
 */
export function PlayByPlay({ game, beta = false }: { game: LiveGame; beta?: boolean }) {
  // Collapsed by default — the play-by-play list is the longest thing
  // on the page and, unlike Scoring/Fantasy Impact above it, isn't
  // usually what someone opens Gamecast to check first. One tap away
  // rather than always taking up the scroll.
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={`flex flex-col gap-3 rounded-xl p-4 sm:p-5 ${beta ? "wl-card" : "neon-panel"}`}
      style={beta ? undefined : panelGlowStyle(SECTION_COLORS.chat)}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">Live Play-by-Play</h2>
        {game.plays.length > 0 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="shrink-0 rounded-full border border-black/10 px-3 py-1 text-xs font-medium text-black/60 hover:bg-black/5 dark:border-white/10 dark:text-white/60 dark:hover:bg-white/10"
          >
            {expanded ? "Hide plays" : `Show plays (${game.plays.length})`}
          </button>
        )}
      </div>

      {game.plays.length === 0 ? (
        <p className="text-sm text-black/50 dark:text-white/50">No plays yet.</p>
      ) : !expanded ? null : (
        <ol className="flex flex-col gap-2">
          {game.plays.map((play) => {
            const emphasis = emphasisFor(play);
            const color = play.players_involved[0]?.team_abbr ? nflTeamColor(play.players_involved[0].team_abbr) : null;
            return (
              <li
                key={play.play_id}
                className={`gamecast-play-enter rounded-lg border px-3 py-2 text-sm ${
                  emphasis ? EMPHASIS_STYLE[emphasis] : "border-black/5 dark:border-white/5"
                }`}
              >
                <div className="flex items-baseline justify-between gap-2 text-xs text-black/50 dark:text-white/50">
                  <span className="tabular-nums">{play.clock}</span>
                  {play.down !== null && play.distance !== null && (
                    <span className="tabular-nums">
                      {ordinal(play.down)} &amp; {play.distance}
                    </span>
                  )}
                </div>
                <p className={emphasis === "score" ? "font-semibold" : undefined} style={emphasis === "score" ? { color: color ?? undefined } : undefined}>
                  {play.description}
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function ordinal(n: number): string {
  const suffixes = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${suffixes[(v - 20) % 10] ?? suffixes[v] ?? suffixes[0]}`;
}
