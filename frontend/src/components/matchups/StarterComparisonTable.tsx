"use client";

import { useEffect, useState } from "react";
import type { RosterPlayer } from "@/lib/api";
import { getScoringRules } from "@/lib/leaguesApi";
import { usePlayerCard } from "@/components/players/PlayerCardProvider";
import { PlayerHeadshot } from "@/components/PlayerHeadshot";
import { formatGameTime } from "@/lib/gameTime";
import { humanizeStatCategory } from "@/lib/scoringLabels";
import { nflTeamName, teamLogoUrl } from "@/lib/nfl-teams";
import { BENCH_SLOT_LABEL, slotDisplayLabel, starterSortIndex } from "@/lib/rosterSlots";

// "Jason Myers" -> "J. Myers" — the reference layout (real ESPN
// matchup screen, 2026-09) always shows first-initial + last name, not
// because it's shorter on average but because it's the LAST name (the
// one someone actually recognizes at a glance) that's guaranteed to
// survive truncation on a narrow phone instead of the first.
//
// A D/ST row's player_name is a real full team name ("Los Angeles
// Chargers"), not a person, so the same initial+lastname trick doesn't
// apply — but a real 2026-09 phone screenshot showed these were the
// worst truncation offenders of all (full city + mascot name is
// consistently the longest string in the whole table), so the same
// "keep only the recognizable last word" principle applies here too:
// just the mascot ("Chargers", "Chiefs"), the same shorthand ESPN's
// own reference layout and ordinary fantasy conversation both already
// use for a team defense.
function displayName(player: RosterPlayer): string {
  if (player.position === "DEF") {
    const words = player.player_name.trim().split(/\s+/);
    return words[words.length - 1];
  }
  const parts = player.player_name.trim().split(/\s+/);
  if (parts.length < 2) return player.player_name;
  return `${parts[0].charAt(0)}. ${parts.slice(1).join(" ")}`;
}

// Starters only (bench/IR excluded), in the same QB/RB/RB/WR/WR/TE/
// FLEX/D-ST/K order the roster edit UI already uses (STARTER_SLOT_ORDER
// in lib/rosterSlots.ts) — a real multi-RB/WR league has more than one
// player per slot label, so ties within a slot fall back to name so
// the two sides' Nth-ranked starter in a slot lines up on the same row
// as consistently as possible without this app tracking a "starter 1
// vs starter 2" identity anywhere.
function starters(roster: RosterPlayer[]): RosterPlayer[] {
  return [...roster]
    .filter((p) => p.lineup_slot !== BENCH_SLOT_LABEL && p.lineup_slot !== "IR")
    .sort((a, b) => {
      const ai = starterSortIndex(a.lineup_slot ?? "");
      const bi = starterSortIndex(b.lineup_slot ?? "");
      return ai !== bi ? ai - bi : a.player_name.localeCompare(b.player_name);
    });
}

// "QUESTIONABLE" -> "Q" — the reference layout (real ESPN matchup
// screen, 2026-09) shows a single-letter flag right next to the name
// instead of a separate pill on its own line, which is a big part of
// why it reads as spacious instead of cluttered at the same
// information density. Falls back to the first letter for a status
// this map doesn't know about, rather than silently dropping it.
const INJURY_SHORT_CODE: Record<string, string> = {
  QUESTIONABLE: "Q",
  DOUBTFUL: "D",
  OUT: "O",
  IR: "IR",
  PUP: "PUP",
  SUSPENDED: "S",
};

function injuryShortCode(status: string): string {
  return INJURY_SHORT_CODE[status] ?? status.slice(0, 1);
}

// Compact live box-score line ("5 REC, 53 YDS, 1 TD") from the same
// raw per-category stat counts app/domain/scoring_engine.py scores off
// of — the reference (real ESPN matchup screen, 2026-09) shows this
// instead of the schedule line once a player has actually recorded
// real stats. Only nonzero categories render; yardage gets a RUSH/REC/
// PASS prefix only when a player has more than one yardage category
// this week (a dual-threat game), otherwise bare "YDS" reads cleaner
// and unambiguous. The pts_allow_*/yds_allow_* categories are bucket
// flags (e.g. pts_allow_7_13: 1), not the literal points/yards allowed
// number, so they're deliberately left out rather than shown as a
// misleading "1 PA".
function formatStatLine(rawStats: Record<string, number> | null): string | null {
  if (!rawStats) return null;
  const n = (key: string) => rawStats[key] ?? 0;
  const yardageKeys = ["rush_yd", "rec_yd", "pass_yd"].filter((k) => n(k) > 0);
  const yardLabel = (key: string, prefix: string) =>
    n(key) > 0 ? `${Math.round(n(key))} ${yardageKeys.length > 1 ? `${prefix} ` : ""}YDS` : null;

  const parts = [
    n("pass_td") > 0 && `${n("pass_td")} PASS TD`,
    yardLabel("pass_yd", "PASS"),
    n("pass_int") > 0 && `${n("pass_int")} INT`,
    n("rush_td") > 0 && `${n("rush_td")} RUSH TD`,
    yardLabel("rush_yd", "RUSH"),
    n("rec") > 0 && `${n("rec")} REC`,
    yardLabel("rec_yd", "REC"),
    n("rec_td") > 0 && `${n("rec_td")} REC TD`,
    (n("def_return_td") > 0 || n("ret_td") > 0) && `${n("def_return_td") + n("ret_td")} TD`,
    n("def_sack") > 0 && `${n("def_sack")} SACK`,
    n("def_int") > 0 && `${n("def_int")} INT`,
    n("def_fum_rec") > 0 && `${n("def_fum_rec")} FR`,
    n("def_safety") > 0 && `${n("def_safety")} SFTY`,
    n("fum_lost") > 0 && `${n("fum_lost")} FUM`,
    n("xp_made") > 0 && `${n("xp_made")} XP`,
  ].filter(Boolean) as string[];

  return parts.length > 0 ? parts.join(", ") : null;
}

// Reference: real ESPN player-score modal, 2026-09 — headshot, name,
// "Week N vs. Team", then a SCORING CATEGORY / PTS PER / # / SCORE
// table, one row per stat category that actually contributed. Only
// categories with both a nonzero count AND a nonzero league rate show
// — a bucket that genuinely happened but is worth 0 points this league
// (e.g. an 18-27-point-allowed week) isn't a "score," so leaving it out
// keeps the visible rows summing to the real total instead of adding
// zero-value noise. TOTAL always shows the player's real
// points_scored, not a client-side re-sum of these rows — the backend
// (app/domain/scoring_engine.py) is the one source of truth for that
// number; this table only ever explains it.
function ScoreBreakdownModal({
  player,
  week,
  rates,
  onClose,
}: {
  player: RosterPlayer;
  week: number;
  rates: Record<string, number>;
  onClose: () => void;
}) {
  const rows = Object.entries(player.raw_stats ?? {})
    .map(([key, count]) => ({ key, label: humanizeStatCategory(key), rate: rates[key] ?? 0, count }))
    .filter((r) => r.count !== 0 && r.rate !== 0)
    .map((r) => ({ ...r, score: r.rate * r.count }))
    .sort((a, b) => Math.abs(b.score) - Math.abs(a.score));

  const oppAbbr = player.next_opponent?.replace(/^(vs|@)\s*/, "").trim() || null;
  const oppName = oppAbbr ? nflTeamName(oppAbbr) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="wl-card relative flex max-h-[85vh] w-full max-w-sm flex-col overflow-y-auto rounded-xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-lg text-black/50 hover:bg-black/5 dark:text-white/50 dark:hover:bg-white/10"
        >
          {"✕"}
        </button>

        <div className="flex flex-col items-center gap-2 pt-2 text-center">
          <PlayerHeadshot
            playerId={typeof player.player_id === "number" ? player.player_id : null}
            sleeperPlayerId={typeof player.player_id === "string" ? player.player_id : null}
            proTeam={player.pro_team}
            name={player.player_name}
            size={72}
          />
          <h2 className="text-lg font-bold">{player.player_name}</h2>
          <p className="text-sm text-black/50 dark:text-white/50">
            Week {week}
            {oppName && ` vs. ${oppName}`}
          </p>
        </div>

        <div className="mt-4 flex flex-col divide-y divide-black/5 dark:divide-white/5">
          <div className="grid grid-cols-[1fr_3.5rem_2rem_3rem] gap-2 pb-2 text-[10px] font-semibold tracking-wide text-black/40 uppercase dark:text-white/40">
            <span>Scoring Category</span>
            <span className="text-right">Pts Per</span>
            <span className="text-right">#</span>
            <span className="text-right">Score</span>
          </div>
          {rows.length === 0 ? (
            <p className="py-3 text-sm text-black/50 dark:text-white/50">No scoring stats recorded yet.</p>
          ) : (
            rows.map((r) => (
              <div key={r.key} className="grid grid-cols-[1fr_3.5rem_2rem_3rem] items-center gap-2 py-2.5 text-sm">
                <span className="min-w-0">{r.label}</span>
                <span className="text-right tabular-nums text-black/50 dark:text-white/50">{r.rate}</span>
                <span className="text-right tabular-nums text-black/50 dark:text-white/50">{r.count}</span>
                <span className="text-right font-semibold tabular-nums">{r.score.toFixed(1)}</span>
              </div>
            ))
          )}
          <div className="flex items-center justify-between pt-2.5 text-base font-bold">
            <span>Total</span>
            <span className="tabular-nums">{(player.points_scored ?? 0).toFixed(1)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// Everything for ONE player lives in a single flex column here —
// deliberately not split across separate flex siblings (an earlier
// version put the projected-points number in its own sibling box next
// to a mirrored/flex-row-reverse name block, which on a narrow phone
// let the two siblings' text visually collide — 2026-09, reported).
// Keeping name+points on the same line, in the same box, guarantees
// the browser can never lay them on top of each other. The name and
// the score are still two independent buttons (not one wrapping the
// whole row) — nested <button>s aren't valid HTML, and they open two
// different things (the player card vs. this week's score breakdown).
//
// Uses the real NFL team's badge (small, 24px) instead of a player
// headshot photo — matched to the reference screenshot's own choice,
// which is most of why it reads as roomy at a glance: no headshot
// means more width for the name to run at a bigger size before
// truncating, and no headshot column means less to visually parse
// per row. My Team's own roster view keeps real headshots — this is
// specific to the matchup screen's side-by-side density.
function PlayerCell({
  player,
  mounted,
  onOpen,
  onOpenBreakdown,
}: {
  player: RosterPlayer | null;
  mounted: boolean;
  onOpen: (sleeperPlayerId: string) => void;
  onOpenBreakdown: (player: RosterPlayer) => void;
}) {
  if (!player) return <div className="min-w-0 flex-1" />;
  const clickable = typeof player.player_id === "string";
  const logo = teamLogoUrl(player.pro_team);
  const showInjury = player.injury_status && player.injury_status !== "ACTIVE";
  const statLine = formatStatLine(player.raw_stats);
  // The score is only worth a click once there's a real breakdown to
  // show — a still-just-projected number has no raw_stats behind it.
  const scoreClickable = clickable && player.points_scored != null;

  const nameSpan = (
    <>
      {displayName(player)}
      {showInjury && (
        <span
          className="ml-1.5 text-xs font-bold text-red-500 dark:text-red-400"
          title={player.injury_status ?? undefined}
        >
          {injuryShortCode(player.injury_status as string)}
        </span>
      )}
    </>
  );

  // Reference (real ESPN matchup screen, 2026-09): the live score sits
  // above, the projection stays visible in a smaller/muted line right
  // underneath it — never replaced outright, so "what was this player
  // supposed to do" stays one glance away from "what they actually
  // did." Pre-kickoff (no live score yet) collapses back to the single
  // projected number, same as before.
  const scoreSpan = (
    <span className="flex shrink-0 flex-col items-end leading-tight">
      <span
        className={
          player.points_scored != null
            ? "text-sm font-semibold tabular-nums"
            : "text-sm tabular-nums text-black/50 dark:text-white/50"
        }
      >
        {player.points_scored != null
          ? player.points_scored.toFixed(1)
          : player.points_projected != null
            ? player.points_projected.toFixed(1)
            : "—"}
      </span>
      {player.points_scored != null && player.points_projected != null && (
        <span className="text-[11px] tabular-nums text-black/40 dark:text-white/40">
          {player.points_projected.toFixed(1)}
        </span>
      )}
    </span>
  );

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2.5">
      <span className="relative inline-flex h-6 w-6 shrink-0 items-center">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element -- ESPN's CDN, not a static asset next/image can optimize.
          <img src={logo} alt="" width={24} height={24} className="h-6 w-6 object-contain" />
        ) : null}
        {/* Same live cross-reference/legend as MyTeamApp's own roster
            row (RosterEntry.is_redzone/on_offense) — red for the red
            zone, amber for on offense elsewhere on the field. Only
            ever true during a real in-progress game for this player's
            real NFL team, for either side of the matchup. */}
        {player.is_redzone ? (
          <span
            className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-red-500 ring-2 ring-[var(--background)]"
            title="In the red zone"
          />
        ) : player.on_offense ? (
          <span
            className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-amber-400 ring-2 ring-[var(--background)]"
            title="On offense"
          />
        ) : null}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-baseline gap-1.5">
          {clickable ? (
            <button
              onClick={() => onOpen(player.player_id as string)}
              className="min-w-0 flex-1 truncate text-left text-xs font-semibold hover:underline"
            >
              {nameSpan}
            </button>
          ) : (
            <span className="min-w-0 flex-1 truncate text-xs font-semibold">{nameSpan}</span>
          )}
          {scoreClickable ? (
            <button onClick={() => onOpenBreakdown(player)} className="shrink-0 hover:underline">
              {scoreSpan}
            </button>
          ) : (
            scoreSpan
          )}
        </span>
        <span className="truncate text-xs text-black/50 dark:text-white/50">
          {statLine ?? (
            <>
              {player.pro_team ?? "—"}
              {player.next_opponent && ` ${player.next_opponent}`}
              {player.game_time && mounted && ` · ${formatGameTime(player.game_time)}`}
            </>
          )}
        </span>
      </span>
    </div>
  );
}

/**
 * The two-column starter breakdown — one row per starter slot
 * (QB/RB/RB/WR/WR/TE/FLEX/D-ST/K), home's player on the left, away's
 * on the right, each with their real projected points, next real
 * opponent/game time, and an inline injury flag when they have one.
 * Bench/IR players never appear here. A CSS grid (not nested flex)
 * sizes the slot label column exactly and gives both sides identical,
 * bounded space.
 */
export function StarterComparisonTable({
  home,
  away,
  season,
  week,
}: {
  home: RosterPlayer[];
  away: RosterPlayer[];
  season: number;
  week: number;
}) {
  const { openPlayerCard } = usePlayerCard();
  const [mounted, setMounted] = useState(false);
  const [rates, setRates] = useState<Record<string, number>>({});
  const [breakdownPlayer, setBreakdownPlayer] = useState<RosterPlayer | null>(null);

  useEffect(() => {
    // setTimeout(0), not a direct setState call in the effect body —
    // same lint-satisfying pattern FreeAgentsList.tsx's identical mount
    // effect uses.
    const id = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    // Fetched once per season, not per player-click — the same rates
    // apply to every starter on this page.
    getScoringRules(season)
      .then(({ rules }) => setRates(Object.fromEntries(rules.map((r) => [r.stat_category, r.points_per_unit]))))
      .catch(() => {
        /* the breakdown modal just won't open without a real rate to show — see scoreClickable */
      });
  }, [season]);

  const homeStarters = starters(home);
  const awayStarters = starters(away);

  // Grouped by lineup_slot and zipped WITHIN each group, not by a flat
  // index across every starter — a flat zip silently breaks the moment
  // the two rosters have a different number of starters at any slot
  // (most commonly: one team has no FLEX set this week). Home's real
  // D/ST and K would end up lined up against whatever fell into those
  // array positions on the short side — a real team defense rendered
  // in the FLEX row, a kicker rendered in the D/ST row, labeled with
  // the WRONG team's slot name, real screenshot report 2026-09-13.
  // Grouping first means a slot either side is missing just renders
  // that side's cell empty, instead of shifting every later slot up.
  function groupBySlot(list: RosterPlayer[]): Map<string, RosterPlayer[]> {
    const map = new Map<string, RosterPlayer[]>();
    for (const p of list) {
      const key = p.lineup_slot ?? "";
      const group = map.get(key);
      if (group) group.push(p);
      else map.set(key, [p]);
    }
    return map;
  }

  const homeBySlot = groupBySlot(homeStarters);
  const awayBySlot = groupBySlot(awayStarters);
  const slotLabels = Array.from(new Set([...homeBySlot.keys(), ...awayBySlot.keys()])).sort(
    (a, b) => starterSortIndex(a) - starterSortIndex(b)
  );

  const rows: { home: RosterPlayer | null; away: RosterPlayer | null; slot: string }[] = [];
  for (const slotLabel of slotLabels) {
    const homeGroup = homeBySlot.get(slotLabel) ?? [];
    const awayGroup = awayBySlot.get(slotLabel) ?? [];
    const count = Math.max(homeGroup.length, awayGroup.length);
    for (let i = 0; i < count; i++) {
      rows.push({ home: homeGroup[i] ?? null, away: awayGroup[i] ?? null, slot: slotDisplayLabel(slotLabel) });
    }
  }

  if (rows.length === 0) {
    return <p className="text-sm text-black/50 dark:text-white/50">No starting lineup set for this week yet.</p>;
  }

  return (
    <div className="flex flex-col divide-y divide-black/5 dark:divide-white/5">
      {rows.map((row, i) => (
        <div key={i} className="grid grid-cols-[1fr_2.5rem_1fr] items-center gap-2 py-4">
          <PlayerCell player={row.home} mounted={mounted} onOpen={openPlayerCard} onOpenBreakdown={setBreakdownPlayer} />
          <span className="text-center text-[11px] font-semibold tracking-wide text-black/40 uppercase dark:text-white/40">
            {row.slot}
          </span>
          <PlayerCell player={row.away} mounted={mounted} onOpen={openPlayerCard} onOpenBreakdown={setBreakdownPlayer} />
        </div>
      ))}
      {breakdownPlayer && (
        <ScoreBreakdownModal
          player={breakdownPlayer}
          week={week}
          rates={rates}
          onClose={() => setBreakdownPlayer(null)}
        />
      )}
    </div>
  );
}
