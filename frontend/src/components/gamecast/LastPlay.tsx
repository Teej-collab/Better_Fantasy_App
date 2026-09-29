"use client";

import { useEffect, useState } from "react";
import { getPlayFantasy, type GamecastPlay, type GamecastPlayFantasyPlayer, type LiveGame } from "@/lib/gamecastApi";
import { nflTeamColor } from "@/lib/nfl-teams";
import { BENCH_SLOT_LABEL, IR_SLOT_LABEL } from "@/lib/rosterSlots";
import { SECTION_COLORS, panelGlowStyle } from "@/lib/sectionColors";
import { useOnAppRefresh } from "@/lib/usePullToRefresh";

// Bookkeeping entries ESPN puts in the play list that aren't a snap —
// the card should always show the last real play, not "End Period".
const NON_SNAP_TYPES = new Set(["timeout", "other"]);

function lastSnap(game: LiveGame): GamecastPlay | null {
  return game.plays.find((p) => p.is_scoring_play || !NON_SNAP_TYPES.has(p.play_type)) ?? null;
}

/**
 * The most recent snap, directly under the field graphic: what happened
 * (ESPN's own description), the down & distance it was run on, yards
 * gained, and — the fantasy half — every player rostered in the
 * viewer's league who was on it, with the points that one play earned
 * them under this league's own scoring (backend
 * app/gamecast/last_play.py). The play itself rides the gamecast
 * WebSocket like everything else here; the fantasy half is fetched when
 * a new play lands, and re-checked on the app's live refresh tick.
 */
export function LastPlay({ game, beta = false }: { game: LiveGame; beta?: boolean }) {
  const play = lastSnap(game);
  const playId = play?.play_id ?? null;
  const [fantasy, setFantasy] = useState<{ playId: string; players: GamecastPlayFantasyPlayer[] } | null>(null);

  useEffect(() => {
    if (playId === null) return;
    let cancelled = false;
    getPlayFantasy(game.game_id, playId).then((players) => {
      if (!cancelled && players) setFantasy({ playId, players });
    });
    return () => {
      cancelled = true;
    };
  }, [game.game_id, playId]);

  // Re-asks on the live 15s tick / pull-to-refresh: a play seconds old
  // can come back before ESPN has attached its players (the backend
  // doesn't cache that empty answer), and a reviewed play can change.
  useOnAppRefresh(() => {
    if (playId === null) return;
    return getPlayFantasy(game.game_id, playId).then((players) => {
      if (players) setFantasy({ playId, players });
    });
  });

  const shellClass = `flex flex-col gap-3 rounded-xl p-4 sm:p-5 ${beta ? "wl-card" : "neon-panel"}`;
  const offenseColor = play?.team_abbr ? nflTeamColor(play.team_abbr) : null;
  const shellStyle = beta ? undefined : panelGlowStyle(offenseColor ?? SECTION_COLORS.matchups);

  if (!play) {
    return (
      <div className={shellClass} style={shellStyle}>
        <h2 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">Last Play</h2>
        <p className="text-sm text-black/50 dark:text-white/50">No plays yet.</p>
      </div>
    );
  }

  // Only the current play's fantasy rows — never the previous play's
  // players under a new play's description while the fetch is in flight.
  const players = fantasy?.playId === play.play_id ? fantasy.players : [];

  return (
    <div className={shellClass} style={shellStyle}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">Last Play</h2>
        <span className="text-xs tabular-nums text-black/50 dark:text-white/50">
          Q{play.period} {play.clock}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        {play.team_abbr && (
          <span className="font-bold" style={{ color: offenseColor ?? undefined }}>
            {play.team_abbr}
          </span>
        )}
        {play.down !== null && play.distance !== null && (
          <span className="tabular-nums">
            {ordinal(play.down)} &amp; {play.distance}
          </span>
        )}
        {play.yards_gained !== null && play.play_type !== "penalty" && (
          <span
            className={`font-semibold tabular-nums ${play.yards_gained < 0 ? "text-red-500" : play.yards_gained > 0 ? "text-emerald-500" : ""}`}
          >
            {play.yards_gained > 0 ? "+" : ""}
            {play.yards_gained} yd{Math.abs(play.yards_gained) === 1 ? "" : "s"}
          </span>
        )}
        {play.is_scoring_play && <Badge className="bg-amber-500/15 text-amber-500">Score</Badge>}
        {play.is_turnover && <Badge className="bg-red-500/15 text-red-500">Turnover</Badge>}
        {play.is_first_down && !play.is_scoring_play && <Badge className="bg-sky-500/15 text-sky-500">1st Down</Badge>}
      </div>

      <p className="text-sm leading-snug text-black/80 dark:text-white/80">{play.description}</p>

      {players.length > 0 && (
        <ul className="flex flex-col gap-1.5 border-t border-black/10 pt-3 dark:border-white/10">
          {players.map((p) => (
            <FantasyRow key={p.player_id} player={p} />
          ))}
        </ul>
      )}
    </div>
  );
}

function FantasyRow({ player }: { player: GamecastPlayFantasyPlayer }) {
  // Bench/IR points don't count toward anyone's matchup — still shown
  // (it's their player, and it happened), just visibly de-emphasized.
  const counts = player.lineup_slot !== BENCH_SLOT_LABEL && player.lineup_slot !== IR_SLOT_LABEL;
  const tag = player.is_mine ? "You" : player.is_opponent ? "Opp" : null;
  return (
    <li className={`flex items-center gap-2 text-sm ${counts ? "" : "opacity-50"}`}>
      <span className="min-w-0 flex-1">
        <span className="font-medium">{player.player_name}</span>
        <span className="ml-1.5 text-xs text-black/50 dark:text-white/50">
          {player.position} · {player.team_name}
          {!counts && " · Bench"}
        </span>
      </span>
      {tag && (
        <Badge className={player.is_mine ? "bg-emerald-500/15 text-emerald-500" : "bg-red-500/15 text-red-500"}>
          {tag}
        </Badge>
      )}
      <span
        className={`shrink-0 font-mono font-semibold tabular-nums ${player.points < 0 ? "text-red-500" : player.points > 0 ? "text-emerald-500" : "text-black/50 dark:text-white/50"}`}
      >
        {player.points > 0 ? "+" : ""}
        {player.points.toFixed(1)}
      </span>
    </li>
  );
}

function Badge({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase ${className}`}>
      {children}
    </span>
  );
}

function ordinal(n: number): string {
  const suffixes = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${suffixes[(v - 20) % 10] ?? suffixes[v] ?? suffixes[0]}`;
}
