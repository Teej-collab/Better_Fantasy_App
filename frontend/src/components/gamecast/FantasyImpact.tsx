"use client";

import { useEffect, useState } from "react";
import { getFantasyImpact, type GamecastFantasyImpact, type GamecastImpactPlayer } from "@/lib/gamecastApi";
import type { LiveGame } from "@/lib/gamecastApi";
import { nflTeamName, teamLogoUrl } from "@/lib/nfl-teams";
import { SECTION_COLORS, panelGlowStyle } from "@/lib/sectionColors";

const POLL_MS = 15000;

function headshotUrl(playerId: string | undefined): string | null {
  return playerId ? `https://sleepercdn.com/content/nfl/players/${playerId}.jpg` : null;
}

function PlayerRow({ player }: { player: GamecastImpactPlayer }) {
  const headshot = headshotUrl(player.player_id);
  return (
    <li className="flex items-center gap-2 rounded-lg bg-black/[0.02] px-2.5 py-1.5 text-sm dark:bg-white/[0.03]">
      {headshot ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={headshot} alt="" className="h-7 w-7 shrink-0 rounded-full bg-black/10 object-cover object-top dark:bg-white/10" />
      ) : (
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-black/10 text-[10px] font-semibold text-black/50 dark:bg-white/10 dark:text-white/50">
          {player.position}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate font-medium">{player.player_name}</span>
      <span className="shrink-0 font-mono text-sm font-semibold tabular-nums">{player.points_scored.toFixed(1)}</span>
    </li>
  );
}

/**
 * "Your top scoring players in this game, live" — real fantasy_points
 * from Phase D's own scoring engine (app/gamecast/service.py's
 * build_fantasy_impact), replacing the old text-scraped "mentioned in
 * a play" version (2026-09-18 redesign, reference: a real ESPN
 * Gamecast screenshot showing exactly this three-section shape). Polls
 * a REST endpoint on an interval rather than riding the existing
 * gamecast WebSocket — real fantasy_points only ever change on the
 * scheduler's own poll cadence, not play-by-play, so a WS push here
 * would be over-engineering for how often this actually moves.
 */
export function FantasyImpact({
  game,
  isSignedIn,
  beta = false,
}: {
  game: LiveGame;
  isSignedIn: boolean;
  beta?: boolean;
}) {
  const [data, setData] = useState<GamecastFantasyImpact | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const impact = await getFantasyImpact(game.game_id);
      if (!cancelled && impact) setData(impact);
    }

    load();
    const isLive = game.status === "in_progress" || game.status === "halftime";
    const id = isLive ? setInterval(load, POLL_MS) : null;
    return () => {
      cancelled = true;
      if (id) clearInterval(id);
    };
  }, [game.game_id, game.status]);

  return (
    <div
      className={`flex flex-col gap-4 rounded-xl p-4 sm:p-5 ${beta ? "wl-card" : "neon-panel"}`}
      style={beta ? undefined : panelGlowStyle(SECTION_COLORS.league)}
    >
      <h2 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">Fantasy Impact</h2>

      {!data && <p className="text-sm text-black/50 dark:text-white/50">Loading…</p>}

      {data && (
        <>
          <ImpactSection
            label="Your Players"
            team={data.your_team}
            players={data.your_players}
            signedOutLabel={!isSignedIn ? "Sign in to see your players in this game." : null}
          />
          <ImpactSection
            label="Opposing Players"
            team={data.opponent_team}
            players={data.opponent_players}
            signedOutLabel={!isSignedIn ? "Sign in to see your opponent's players in this game." : null}
          />
          <GameLeaders leaders={data.game_leaders} />
        </>
      )}
    </div>
  );
}

function ImpactSection({
  label,
  team,
  players,
  signedOutLabel,
}: {
  label: string;
  team: { team_id: number; team_name: string } | null;
  players: GamecastImpactPlayer[];
  signedOutLabel: string | null;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <h3 className="text-[0.65rem] font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">{label}</h3>
        {team && <span className="truncate text-xs text-black/40 dark:text-white/40">{team.team_name}</span>}
      </div>
      {signedOutLabel ? (
        <p className="text-xs text-black/40 dark:text-white/40">{signedOutLabel}</p>
      ) : !team ? (
        <p className="text-xs text-black/40 dark:text-white/40">No team in this league this season.</p>
      ) : players.length === 0 ? (
        <p className="text-xs text-black/40 dark:text-white/40">No players in this game.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {players.map((p) => (
            <PlayerRow key={p.player_id ?? p.player_name} player={p} />
          ))}
        </ul>
      )}
    </div>
  );
}

function GameLeaders({ leaders }: { leaders: GamecastFantasyImpact["game_leaders"] }) {
  const sides = [leaders.away, leaders.home];
  const anyLeaders = sides.some((s) => s.leaders.length > 0);
  if (!anyLeaders) return null;

  return (
    <div className="flex flex-col gap-1.5 border-t border-black/[0.06] pt-3 dark:border-white/[0.08]">
      <h3 className="text-[0.65rem] font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">Game Leaders</h3>
      <div className="grid grid-cols-2 gap-3">
        {sides.map((side) => {
          const logo = teamLogoUrl(side.abbr);
          return (
            <div key={side.abbr} className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5">
                {logo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logo} alt="" className="h-4 w-4 object-contain" />
                )}
                <span className="text-xs font-semibold">{nflTeamName(side.abbr) ?? side.abbr}</span>
              </div>
              <ul className="flex flex-col gap-1">
                {side.leaders.map((p) => (
                  <li key={p.player_id ?? p.player_name} className="flex items-center justify-between gap-2 text-xs">
                    <span className="min-w-0 truncate text-black/70 dark:text-white/70">
                      {p.player_name} <span className="text-black/40 dark:text-white/40">{p.position}</span>
                    </span>
                    <span className="shrink-0 font-mono tabular-nums text-black/70 dark:text-white/70">
                      {p.points_scored.toFixed(1)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
