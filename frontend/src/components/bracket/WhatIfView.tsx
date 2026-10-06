"use client";

import { useState } from "react";
import type { PlayoffWorld, Scenario, World, WorldGame, WorldTeam } from "@/lib/bracketEngine";
import { changeCount, isEmpty, ordinal, recordOf } from "@/lib/bracketEngine";
import { GameTile } from "@/components/bracket/GameTile";

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

      <div className="grid gap-5 lg:grid-cols-[minmax(0,420px)_minmax(0,320px)_minmax(0,1fr)]">
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
              return (
                <div
                  key={g.id}
                  className="flex items-center gap-2 rounded-xl border px-2.5 py-1.5"
                  style={{ background: changed ? "rgba(57,255,20,0.07)" : "#12161c", borderColor: changed ? "#39ff14" : "#1c2027" }}
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
                  <span className="w-12 text-right font-mono text-[10px] text-[#7f8a99]">{g.played ? (changed ? "FLIPPED" : "FINAL") : changed ? "PICK" : "FAV"}</span>
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

        <section className="flex min-w-0 flex-col gap-2">
          <h2 className="font-display text-xl tracking-wide">THE BRACKET, IN THIS WORLD</h2>
          <p className="text-xs text-[#9aa3b2]">Tap a team to pick them; tap again to go back to the favorite.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {alt.games.map((g) => (
              <GameTile
                key={g.code}
                game={g}
                all={alt.games}
                teams={teams}
                records={altRecords}
                punishment={world.toilet_bowl_punishment}
                me={me}
                compact
                onPick={(t) => pickPlayoff(g.code, t)}
              />
            ))}
          </div>
        </section>
      </div>
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
