"use client";

import { useState } from "react";
import type { PlayoffOdds } from "@/lib/api";
import type { PlayoffWorld, Scenario, World, WorldGame, WorldTeam } from "@/lib/bracketEngine";
import { changeCount, isEmpty, ordinal, recordOf } from "@/lib/bracketEngine";
import { BracketBoard } from "@/components/bracket/ArenaView";

// The What-If Lab (mockup C): flip any result, pick any game still to
// play, pick playoff winners on the bracket itself — and watch the
// standings, seeds and both brackets re-form. Everything not picked goes
// to the favorite. Share sends the exact world as a link.

export function WhatIfView({
  world,
  base,
  alt,
  teams,
  scenario,
  onScenario,
  me,
  onMe,
  onShareLink,
  onShareChat,
  shareNote,
  odds,
  oddsUpdating,
}: {
  world: PlayoffWorld;
  base: World;
  alt: World;
  teams: Record<number, WorldTeam>;
  scenario: Scenario;
  onScenario: (s: Scenario) => void;
  me: number;
  onMe: (teamId: number) => void;
  onShareLink: () => void;
  onShareChat: () => void;
  shareNote: string | null;
  odds: { real: PlayoffOdds | null; alt: PlayoffOdds | null } | null;
  oddsUpdating: boolean;
}) {
  const [view, setView] = useState<"mine" | number>("mine");
  const weeks = [...new Set(world.schedule.map((g) => g.week))].sort((a, b) => a - b);
  const baseRow = base.standings.find((r) => r.team_id === me)!;
  const altRow = alt.standings.find((r) => r.team_id === me)!;
  const altRecords: Record<number, string> = {};
  for (const r of alt.standings) altRecords[r.team_id] = recordOf(r);
  const baseSeed: Record<number, number> = {};
  for (const r of base.standings) baseSeed[r.team_id] = r.seed;
  const inPlayoffs = altRow.seed <= world.playoff_team_count;
  // Seeds that open in GmC3/GmC4 can lose their way into the Toilet Bowl.
  const bowlLine = world.playoff_team_count + 4;
  const bowlZone = world.games.some((g) => g.toilet_bowl) && altRow.seed > bowlLine;
  const place = alt.places[me];
  const nChanges = changeCount(scenario);

  const flip = (g: WorldGame) => {
    const flips = scenario.flips.includes(g.id) ? scenario.flips.filter((id) => id !== g.id) : [...scenario.flips, g.id];
    onScenario({ ...scenario, flips });
  };
  const pick = (g: WorldGame, team: number | null) => {
    const picks = { ...scenario.picks };
    if (team === null) delete picks[g.id];
    else picks[g.id] = team;
    onScenario({ ...scenario, picks });
  };
  /** Make `team` the winner of g, whichever kind of game it is. */
  const choose = (g: WorldGame, team: number) => {
    if (g.played) {
      const real = g.home_score > g.away_score ? g.home_team_id : g.away_score > g.home_score ? g.away_team_id : null;
      const flipped = scenario.flips.includes(g.id);
      if ((real === team) === flipped) flip(g);
    } else {
      pick(g, scenario.picks[g.id] === team ? null : team);
    }
  };
  const allMine = (win: boolean) => {
    const picks = { ...scenario.picks };
    for (const g of world.schedule) {
      if (g.played || (g.home_team_id !== me && g.away_team_id !== me)) continue;
      picks[g.id] = win ? me : g.home_team_id === me ? g.away_team_id : g.home_team_id;
    }
    onScenario({ ...scenario, picks });
  };
  const pickPlayoff = (code: string, team: number) => {
    const playoff = { ...scenario.playoff };
    if (playoff[code] === team) delete playoff[code];
    else playoff[code] = team;
    onScenario({ ...scenario, playoff });
  };

  // Playoff chances: the world being shown (what-if if there is one).
  const shownOdds = odds ? (isEmpty(scenario) ? odds.real : (odds.alt ?? odds.real)) : null;
  const focus = shownOdds?.focus ?? null;
  const pctOf = (o: PlayoffOdds | null | undefined, key: "playoff_pct" | "title_pct" | "toilet_bowl_pct") =>
    o?.teams.find((t) => t.team_id === me)?.[key] ?? null;
  const rootFor = new Map((odds?.real?.focus?.root_for ?? focus?.root_for ?? []).map((r) => [r.matchup_id, r]));
  // Root-for games come from reality, so the list stays put as games
  // are added (a picked game can't swing anything in its own world).
  const rootList = (odds?.real?.focus ?? focus)?.root_for ?? [];
  const path = focus?.best_path ?? null;
  /** The realistic path (backend playoff_odds._best_path): win the
   *  winnable games it needs, and the results that help most go your way. */
  const bestPath = () => {
    if (!path) return;
    const picks = { ...scenario.picks };
    for (const g of path.win_games) picks[g.matchup_id] = me;
    for (const r of path.root_for) picks[r.matchup_id] = r.root_for_team_id;
    onScenario({ ...scenario, picks });
  };
  const toggleRoot = (matchupId: number, teamId: number) => {
    const picks = { ...scenario.picks };
    if (picks[matchupId] === teamId) delete picks[matchupId];
    else picks[matchupId] = teamId;
    onScenario({ ...scenario, picks });
  };

  const games = view === "mine" ? world.schedule.filter((g) => g.home_team_id === me || g.away_team_id === me) : world.schedule.filter((g) => g.week === view);

  return (
    <div className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-[#0d1016] p-4 text-[#eceef1] md:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11px] tracking-[0.2em] text-[#9aa3b2]">PLAYING AS</span>
        {base.standings.map((r) => (
          <button
            key={r.team_id}
            type="button"
            onClick={() => onMe(r.team_id)}
            className="font-display h-9 rounded-full border px-3 text-sm"
            style={{
              borderColor: r.team_id === me ? "#fff" : "#2b3340",
              background: r.team_id === me ? "#eceef1" : "transparent",
              color: r.team_id === me ? "#0d1016" : "#eceef1",
            }}
          >
            {teams[r.team_id].name}
          </button>
        ))}
      </div>

      <div
        className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border px-5 py-4"
        style={{
          background: inPlayoffs ? "rgba(57,255,20,0.06)" : bowlZone ? "rgba(168,116,60,0.10)" : "#12161c",
          borderColor: inPlayoffs ? "#39ff14" : bowlZone ? "#a8743c" : "#1c2027",
        }}
      >
        <Stat label="REALITY (PROJECTED)" value={`#${baseRow.seed} · ${recordOf(baseRow)}`} />
        <svg width="34" height="20" viewBox="0 0 40 24" fill="none" stroke="#9aa3b2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M2 12h34M28 4l8 8-8 8" />
        </svg>
        <Stat label="WHAT IF" value={`#${altRow.seed} · ${recordOf(altRow)}`} color={inPlayoffs ? "#39ff14" : bowlZone ? "#d9a066" : "#eceef1"} />
        <p className="min-w-[220px] flex-1 text-[15px] text-[#dfe3ea]">
          {inPlayoffs ? "In the playoffs" : bowlZone ? "In Toilet Bowl territory" : "Out of the playoffs"}
          {place ? ` — finishes ${place === 1 ? "as champion" : ordinal(place)}.` : "."}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-[#9aa3b2]">{nChanges ? `${nChanges} change${nChanges > 1 ? "s" : ""}` : "No changes yet"}</span>
          <button type="button" disabled={isEmpty(scenario)} onClick={onShareLink} className="font-display h-10 rounded-full border border-[#2b3340] px-4 text-sm disabled:opacity-40">
            COPY LINK
          </button>
          <button type="button" disabled={isEmpty(scenario)} onClick={onShareChat} className="font-display h-10 rounded-full bg-[#39ff14] px-4 text-sm text-[#0d1016] disabled:opacity-40">
            SHARE TO LEAGUE CHAT
          </button>
        </div>
        {shareNote && <p className="w-full text-sm text-[#39ff14]">{shareNote}</p>}
      </div>

      <OddsPanel
        world={world}
        teams={teams}
        realPct={pctOf(odds?.real, "playoff_pct")}
        altPct={isEmpty(scenario) ? null : pctOf(odds?.alt, "playoff_pct")}
        titlePct={pctOf(shownOdds, "title_pct")}
        bowlPct={pctOf(shownOdds, "toilet_bowl_pct")}
        focus={focus}
        loading={odds === null || oddsUpdating}
        path={path}
        rootList={rootList}
        picked={scenario.picks}
        onBestPath={bestPath}
        onRoot={toggleRoot}
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <section className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-xl tracking-wide">{view === "mine" ? `${teams[me].name.toUpperCase()}'S SEASON` : `WEEK ${view}`}</h2>
            {view === "mine" && (
              <span className="flex gap-1.5">
                <SmallButton onClick={() => allMine(true)} color="#39ff14">WIN OUT</SmallButton>
                <SmallButton onClick={() => allMine(false)} color="#d9a066">LOSE OUT</SmallButton>
              </span>
            )}
            <SmallButton onClick={() => onScenario({ flips: [], picks: {}, playoff: {} })} color="#eceef1">RESET</SmallButton>
          </div>
          <div className="flex flex-wrap gap-1">
            <WeekChip on={view === "mine"} onClick={() => setView("mine")}>
              Mine
            </WeekChip>
            {weeks.map((wk) => (
              <WeekChip key={wk} on={view === wk} onClick={() => setView(wk)}>
                {wk}
              </WeekChip>
            ))}
          </div>
          <p className="text-xs text-[#9aa3b2]">Tap a team to make them the winner. Played games flip; games ahead get picked. Tap again to undo.</p>
          <div className="flex flex-col gap-1.5">
            {games.map((g) => {
              const winner = alt.results[g.id];
              const changed = g.played ? scenario.flips.includes(g.id) : scenario.picks[g.id] !== undefined;
              const root = !changed ? rootFor.get(g.id) : undefined;
              return (
                <div
                  key={g.id}
                  className="flex items-center gap-2 rounded-xl border px-2.5 py-1.5"
                  style={{
                    background: changed ? "rgba(57,255,20,0.07)" : root ? "rgba(245,197,66,0.07)" : "#12161c",
                    borderColor: changed ? "#39ff14" : root ? "#f5c542" : "#1c2027",
                  }}
                  title={root ? `Root for ${teams[root.root_for_team_id].name}: ${root.pct_if_root}% vs ${root.pct_if_other}%` : undefined}
                >
                  <span className="w-11 font-mono text-[11px] text-[#9aa3b2]">WK {g.week}</span>
                  {[g.home_team_id, g.away_team_id].map((t, i) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => choose(g, t)}
                      aria-label={`${teams[t].name} wins week ${g.week}`}
                      className="font-display flex h-10 min-w-0 flex-1 items-center justify-between gap-2 rounded-lg px-2.5 text-sm"
                      style={{
                        background: winner === t ? (changed ? "#39ff14" : "rgba(255,255,255,0.10)") : "transparent",
                        color: winner === t && changed ? "#0d1016" : winner === t ? "#fff" : "#7f8a99",
                      }}
                    >
                      <span className="truncate">{teams[t].name}</span>
                      {g.played && <span className="font-mono text-[11px]">{(i === 0 ? g.home_score : g.away_score).toFixed(1)}</span>}
                    </button>
                  ))}
                  <span className="w-12 text-right font-mono text-[10px]" style={{ color: root ? "#f5c542" : "#7f8a99" }}>
                    {g.played ? (changed ? "FLIPPED" : "FINAL") : changed ? "PICK" : root ? `ROOT ${teams[root.root_for_team_id].name.toUpperCase()}` : "FAV"}
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="flex min-w-0 flex-col gap-2">
          <h2 className="font-display text-xl tracking-wide">FINAL STANDINGS</h2>
          <p className="text-xs text-[#9aa3b2]">After Week {world.regular_season_last_week} in this world. Arrows compare to reality.</p>
          <div className="flex flex-col overflow-hidden rounded-xl border border-[#1c2027]">
            {alt.standings.map((r, i) => {
              const d = baseSeed[r.team_id] - r.seed;
              return (
                <div key={r.team_id}>
                  <div className="flex h-9 items-center gap-2.5 px-3" style={{ background: r.team_id === me ? "rgba(255,255,255,0.10)" : i % 2 ? "#10141a" : "#12161c" }}>
                    <span className="w-5 font-mono text-xs text-[#9aa3b2]">{r.seed}</span>
                    <span className="font-display flex-1" style={{ color: r.team_id === me ? "#fff" : r.seed > bowlLine ? "#d9a066" : "#eceef1" }}>
                      {teams[r.team_id].name}
                    </span>
                    <span className="w-12 text-right font-mono text-sm">{recordOf(r)}</span>
                    <span className="w-9 text-right font-mono text-xs" style={{ color: d > 0 ? "#39ff14" : "#f87171" }}>
                      {d > 0 ? `▲${d}` : d < 0 ? `▼${-d}` : ""}
                    </span>
                  </div>
                  {r.seed === world.playoff_team_count && <div className="h-0.5 bg-[#39ff14] shadow-[0_0_10px_#39ff14]" />}
                </div>
              );
            })}
          </div>
        </section>


      </div>

      <section className="flex min-w-0 flex-col gap-2">
        <h2 className="font-display text-xl tracking-wide">THE BRACKET, IN THIS WORLD</h2>
        <p className="text-xs text-[#9aa3b2]">Tap a team to pick them to win; tap again to go back to the favorite.</p>
        <BracketBoard world={world} w={alt} teams={teams} records={altRecords} me={me} onPick={pickPlayoff} />
      </section>
    </div>
  );
}

function Stat({ label, value, color = "#eceef1" }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex flex-col">
      <span className="font-mono text-[11px] tracking-[0.15em]" style={{ color: color === "#eceef1" ? "#9aa3b2" : color }}>
        {label}
      </span>
      <span className="font-display text-2xl" style={{ color }}>
        {value}
      </span>
    </div>
  );
}

function SmallButton({ onClick, color, children }: { onClick: () => void; color: string; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="font-display h-9 rounded-full border px-3 text-sm" style={{ borderColor: color === "#eceef1" ? "#2b3340" : color, color }}>
      {children}
    </button>
  );
}

function WeekChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-8 min-w-8 rounded-lg border px-2 font-mono text-xs"
      style={{ borderColor: on ? "#39ff14" : "#2b3340", color: on ? "#39ff14" : "#9aa3b2", background: on ? "rgba(57,255,20,0.08)" : "transparent" }}
    >
      {children}
    </button>
  );
}

function pctText(p: number | null): string {
  if (p === null) return "—";
  if (p > 0 && p < 1) return "<1%";
  if (p < 100 && p > 99) return ">99%";
  return `${Math.round(p)}%`;
}

/** Playoff chances and the paths to get there. */
function OddsPanel({
  world,
  teams,
  realPct,
  altPct,
  titlePct,
  bowlPct,
  focus,
  loading,
  path,
  rootList,
  picked,
  onBestPath,
  onRoot,
}: {
  world: PlayoffWorld;
  teams: Record<number, WorldTeam>;
  realPct: number | null;
  altPct: number | null;
  titlePct: number | null;
  bowlPct: number | null;
  focus: PlayoffOdds["focus"];
  loading: boolean;
  path: NonNullable<PlayoffOdds["focus"]>["best_path"];
  rootList: NonNullable<PlayoffOdds["focus"]>["root_for"];
  picked: Record<number, number>;
  onBestPath: () => void;
  onRoot: (matchupId: number, teamId: number) => void;
}) {
  const shown = altPct ?? realPct;
  const color = shown === null ? "#eceef1" : shown >= 75 ? "#39ff14" : shown <= 10 ? "#d9a066" : "#eceef1";
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-[#1c2027] bg-[#12161c] p-5" aria-busy={loading}>
      <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
        <div className="flex flex-col">
          <span className="font-mono text-[11px] tracking-[0.15em] text-[#9aa3b2]">PLAYOFF CHANCE{altPct !== null ? " · REALITY → WHAT IF" : ""}</span>
          <span className="font-display text-4xl" style={{ color }}>
            {altPct !== null ? `${pctText(realPct)} → ${pctText(altPct)}` : pctText(realPct)}
          </span>
        </div>
        <Small label="TITLE" value={pctText(titlePct)} color="#f5c542" />
        <Small label="TOILET BOWL" value={pctText(bowlPct)} color="#d9a066" />
        <span className="min-w-[200px] flex-1 text-xs text-[#7f8a99]">
          {loading ? "Updating…" : "From 10,000 simulated seasons: scoring average, recent form and power ranking, with real scores so points-for tiebreaks count."}
        </span>
      </div>

      {!path && (
        <div className="rounded-xl border border-[#f5c542]/30 p-4 text-sm text-[#9aa3b2]">
          <span className="font-display mr-3 text-lg tracking-wide text-[#f5c542]">YOUR BEST PATH</span>
          {focus ? "No regular-season games left to plan around." : "Finding your best path…"}
        </div>
      )}
      {path && (
        <div className="flex flex-col gap-3 rounded-xl border border-[#f5c542]/50 bg-[rgba(245,197,66,0.05)] p-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-display text-lg tracking-wide text-[#f5c542]">YOUR BEST PATH</span>
            <span className="text-sm text-[#dfe3ea]">
              {path.target_wins >= path.games_left
                ? `You need to win out (${path.games_left})`
                : `Win ${path.target_wins} of your ${path.games_left} — not all of them`}
              {path.root_for.length > 0 && ", with a little help"} → <b className="text-[#f5c542]">{pctText(path.path_pct)}</b>
            </span>
            <button type="button" onClick={onBestPath} className="font-display ml-auto h-10 rounded-full bg-[#f5c542] px-4 text-sm text-[#0d1016]">
              LIGHT IT UP
            </button>
          </div>
          <p className="text-xs text-[#9aa3b2]">
            The target is the fewest wins that got you in 75%+ of simulated seasons, taken from the games you&apos;re most likely to win; the help is the
            other results that moved your odds most. Then it&apos;s simulated again with all of it locked in.
          </p>
          <div className="flex flex-wrap gap-2 text-xs">
            {path.win_games.map((g) => (
              <span key={g.matchup_id} className="rounded-full border border-[#39ff14]/40 px-2.5 py-1 text-[#dfe3ea]">
                Wk {g.week}: beat {teams[g.opponent_team_id].name} <span className="text-[#9aa3b2]">({pctText(g.win_pct)} likely)</span>
              </span>
            ))}
            {path.root_for.map((r) => (
              <span key={r.matchup_id} className="rounded-full border border-[#f5c542]/40 px-2.5 py-1 text-[#dfe3ea]">
                Wk {r.week}: {teams[r.root_for_team_id].name} over {teams[r.against_team_id].name}
              </span>
            ))}
          </div>
        </div>
      )}

      {focus && (
        <div className="grid gap-5 md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <span className="font-mono text-[11px] tracking-[0.15em] text-[#9aa3b2]">BY WINS LEFT ({focus.games_left} GAMES)</span>
            {focus.by_wins.slice(0, 7).map((r) => (
              <div key={r.wins} className="flex items-center gap-2 text-sm">
                <span className="w-24 shrink-0 text-[#c9cfd8]">{r.wins === r.games_left ? "Win out" : `Win ${r.wins} of ${r.games_left}`}</span>
                <span className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-white/5">
                  <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${r.pct}%`, background: r.pct >= 75 ? "#39ff14" : r.pct >= 25 ? "#f5c542" : "#d9a066" }} />
                </span>
                <span className="w-12 text-right font-mono text-xs">{pctText(r.pct)}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-2 text-sm">
            <span className="font-mono text-[11px] tracking-[0.15em] text-[#9aa3b2]">NEXT GAME</span>
            {focus.next_game ? (
              <p className="text-[#dfe3ea]">
                Week {focus.next_game.week} vs {teams[focus.next_game.opponent_team_id].name}:{" "}
                <span className="text-[#39ff14]">win → {pctText(focus.next_game.if_win_pct)}</span>,{" "}
                <span className="text-[#f87171]">lose → {pctText(focus.next_game.if_loss_pct)}</span>.
              </p>
            ) : (
              <p className="text-[#9aa3b2]">No regular-season games left.</p>
            )}
            <span className="mt-2 font-mono text-[11px] tracking-[0.15em] text-[#9aa3b2]">THE TIEBREAKER</span>
            <p className="text-[#dfe3ea]">
              {focus.tiebreak.tied_at_cut_pct >= 1
                ? `Points for decides your spot in ${pctText(focus.tiebreak.tied_at_cut_pct)} of seasons — tied on record at the playoff line — and you come out on top in ${pctText(focus.tiebreak.won_on_points_pct)} of those. Every point counts.`
                : "Points for almost never decides your spot — it comes down to wins."}
            </p>
          </div>
          <div className="flex flex-col gap-2 text-sm md:col-span-2">
            <span className="font-mono text-[11px] tracking-[0.15em] text-[#9aa3b2]">ROOT FOR — THE GAMES THAT MOVE YOUR ODDS MOST</span>
            {rootList.length === 0 && <p className="text-[#9aa3b2]">No other game moves your odds much.</p>}
            {rootList.slice(0, 6).map((r) => {
              const added = picked[r.matchup_id] === r.root_for_team_id;
              return (
                <div key={r.matchup_id} className="flex items-center gap-2 rounded-xl border px-3 py-2" style={{ borderColor: added ? "#f5c542" : "rgba(245,197,66,0.3)", background: added ? "rgba(245,197,66,0.12)" : "rgba(245,197,66,0.04)" }}>
                  <span className="w-11 shrink-0 font-mono text-[11px] text-[#9aa3b2]">WK {r.week}</span>
                  <span className="flex-1 text-[#dfe3ea]">
                    <b className="text-[#f5c542]">{teams[r.root_for_team_id].name}</b> over {teams[r.against_team_id].name}
                    <span className="block text-xs text-[#9aa3b2]">
                      {pctText(r.pct_if_root)} if they win, {pctText(r.pct_if_other)} if not
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => onRoot(r.matchup_id, r.root_for_team_id)}
                    aria-pressed={added}
                    className="h-9 shrink-0 rounded-full border px-3 text-xs"
                    style={{ borderColor: "#f5c542", background: added ? "#f5c542" : "transparent", color: added ? "#0d1016" : "#f5c542" }}
                  >
                    {added ? "Added ✓" : "Add"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <span className="sr-only">{world.playoff_team_count} teams make the playoffs.</span>
    </section>
  );
}

function Small({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex flex-col">
      <span className="font-mono text-[11px] tracking-[0.15em]" style={{ color }}>
        {label}
      </span>
      <span className="font-display text-2xl" style={{ color }}>
        {value}
      </span>
    </div>
  );
}

