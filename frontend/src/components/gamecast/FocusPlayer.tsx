"use client";

import { ShareButton } from "@/components/share/ShareButton";
import { useEffect, useState } from "react";
import { usePlayerCard } from "@/components/players/PlayerCardProvider";
import { PlayerHeadshot } from "@/components/PlayerHeadshot";
import { getBoxScore, getFantasyImpact, type GamecastBoxScore, type GamecastFantasyImpact, type LiveGame } from "@/lib/gamecastApi";
import { SECTION_COLORS, panelGlowStyle } from "@/lib/sectionColors";
import { useOnAppRefresh } from "@/lib/usePullToRefresh";

const RECENT_PLAYS = 5;

// "J. Love", "J.Love" and "Jordan Love" all → "jlove".
function shorthand(name: string | null | undefined): string | null {
  const parts = (name ?? "").replace(/[^A-Za-z.\s'-]/g, "").split(/[\s.]+/).filter(Boolean);
  if (parts.length < 2) return null;
  return (parts[0][0] + parts[parts.length - 1]).toLowerCase().replace(/[^a-z]/g, "");
}

// The columns worth a tile for each box score category (the app's
// BoxScore COLUMNS); anything else shows its first four.
const COLUMNS: Record<string, string[]> = {
  passing: ["C/ATT", "YDS", "TD", "INT"],
  rushing: ["CAR", "YDS", "TD", "LONG"],
  receiving: ["TGTS", "REC", "YDS", "TD"],
  fumbles: ["FUM", "LOST"],
  kicking: ["FG", "LONG", "XP", "PTS"],
};

/**
 * The player Gamecast was opened for from the matchup (?player=,
 * 2026-11-10): their fantasy points, their line in each box score
 * category they show up in (targets, catches, carries…), and their own
 * plays, newest first. The app's components/gamecast/FocusPlayer.tsx.
 */
export function FocusPlayer({ playerId, game }: { playerId: string; game: LiveGame }) {
  const [box, setBox] = useState<GamecastBoxScore | null>(null);
  const [impact, setImpact] = useState<GamecastFantasyImpact | null>(null);
  const { openPlayerCard } = usePlayerCard();

  function load() {
    getBoxScore(game.game_id).then((b) => b && setBox(b));
    getFantasyImpact(game.game_id).then((i) => i && setImpact(i));
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.game_id, game.status, game.plays[0]?.play_id]);
  useOnAppRefresh(load);

  const lines = (box?.teams ?? []).flatMap((team) =>
    team.categories.flatMap((category) => category.athletes.filter((a) => a.player_id === playerId).map((athlete) => ({ category, athlete, team }))),
  );
  const impactPlayer = [
    ...(impact?.your_players ?? []),
    ...(impact?.opponent_players ?? []),
    ...(impact?.game_leaders.home.leaders ?? []),
    ...(impact?.game_leaders.away.leaders ?? []),
  ].find((p) => p.player_id === playerId);
  const athlete = lines[0]?.athlete;
  const name = athlete?.name ?? impactPlayer?.player_name ?? "Your player";
  const team = lines[0]?.team.abbr ?? impactPlayer?.pro_team ?? null;
  const owner = impact?.your_players.some((p) => p.player_id === playerId)
    ? "Your player"
    : impact?.opponent_players.some((p) => p.player_id === playerId)
      ? "Opponent's player"
      : null;
  // Plays only name players in ESPN's "J.Love" shorthand (backend
  // gamecast/providers/espn.py), so match on initial + surname, the way
  // Fantasy Impact does. game.plays is newest first.
  const key = shorthand(name);
  const plays = key ? game.plays.filter((p) => p.players_involved.some((r) => shorthand(r.name) === key)).slice(0, RECENT_PLAYS) : [];

  return (
    <section className="neon-panel flex flex-col gap-4 rounded-xl p-4 sm:p-5" style={panelGlowStyle(SECTION_COLORS.gamecast)}>
      <div className="flex items-center gap-3">
        <PlayerHeadshot sleeperPlayerId={playerId} proTeam={team} name={name} size={52} />
        <div className="min-w-0 flex-1">
          {owner && <p className="text-[11px] font-extrabold tracking-widest text-emerald-400 uppercase">{owner}</p>}
          <h2 className="truncate text-lg font-extrabold">{name}</h2>
          <p className="text-sm text-white/55">{[athlete?.position ?? impactPlayer?.position, team].filter(Boolean).join(" · ")}</p>
        </div>
        {impactPlayer && (
          <div className="text-right">
            <p className="text-3xl font-extrabold tabular-nums text-emerald-400">{impactPlayer.points_scored.toFixed(1)}</p>
            <p className="text-xs text-white/55">pts</p>
          </div>
        )}
      </div>

      {lines.length === 0 ? (
        <p className="text-sm text-white/55">{game.status === "scheduled" ? "Hasn’t kicked off yet." : "No stats yet."}</p>
      ) : (
        lines.map(({ category, athlete: a }) => {
          const wanted = (COLUMNS[category.key] ?? []).map((l) => category.labels.indexOf(l)).filter((i) => i >= 0);
          const columns = wanted.length ? wanted : category.labels.slice(0, 4).map((_, i) => i);
          return (
            <div key={category.key} className="flex flex-col gap-1.5">
              <h3 className="text-xs font-bold tracking-wider text-white/55 uppercase">{category.title}</h3>
              <div className="flex flex-wrap gap-2">
                {columns.map((i) => (
                  <div key={i} className="min-w-16 rounded-lg bg-white/[0.06] px-3 py-2 text-center">
                    <p className="text-lg font-extrabold tabular-nums">{a.stats[i] ?? "–"}</p>
                    <p className="text-[11px] font-bold text-white/55">{category.labels[i]}</p>
                  </div>
                ))}
              </div>
            </div>
          );
        })
      )}

      {plays.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-bold tracking-wider text-white/55 uppercase">Recent plays</h3>
          {plays.map((p) => (
            <p key={p.play_id} className="flex gap-3 text-sm">
              <span className="w-16 shrink-0 tabular-nums text-white/55">
                Q{p.period} {p.clock}
              </span>
              <span className={p.is_scoring_play ? "font-bold text-emerald-400" : ""}>{p.description}</span>
            </p>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between">
        <button type="button" onClick={() => openPlayerCard(playerId)} className="text-sm font-bold text-emerald-400 hover:underline">
          Player card ›
        </button>
        {lines.length > 0 && <ShareButton shareRef={{ kind: "player", game_id: game.game_id, player_id: playerId }} title={`${name}${team ? ` · ${team}` : ""}`} className="self-auto" />}
      </div>
    </section>
  );
}
