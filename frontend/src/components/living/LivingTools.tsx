"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { submitLineupSwap, type MatchupContextSide, type NflGame, type RosterEntry, type RosterPlayer, type WatchPartyRoom, type WeekMatchupContextItem, type YourWeekMatchup } from "@/lib/api";
import { fmt, isStarter, when } from "@/lib/livingHome";
import { Big, Chip, DOWN, Kicker, LinkText, Panel, Row, Small, UP } from "@/components/living/LivingParts";
import { WeatherPane, windLine, windy } from "@/components/living/WeatherFx";

// Lineup and game-time cards (the website's copy of the app's
// mobile/src/components/living/LineupTools.tsx and LiveTools.tsx).

const WARN = "#ff8a3d";
const HEADS_UP = "#f5b942";
const BAD_STATUS = ["out", "ir", "injured reserve", "suspended", "pup", "doubtful"];
const proj = (p: RosterEntry) => p.live_projected ?? p.points_projected ?? 0;

function bestBackup(roster: RosterEntry[], starter: RosterEntry, week: number | null): RosterEntry | null {
  return (
    roster
      .filter(
        (b) =>
          b.lineup_slot === "BE" &&
          !b.is_locked &&
          b.position === starter.position &&
          !(week != null && b.bye_week === week) &&
          !BAD_STATUS.includes(b.injury_status?.toLowerCase() ?? ""),
      )
      .sort((a, b) => proj(b) - proj(a))[0] ?? null
  );
}

function SwapButton({ starter, backup, label, onChanged }: { starter: RosterEntry; backup: RosterEntry; label: string; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="flex shrink-0 flex-col items-end gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await submitLineupSwap(backup.player_id, starter.player_id);
            onChanged();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Couldn't swap");
          } finally {
            setBusy(false);
          }
        }}
        aria-label={`Start ${backup.player_name} instead of ${starter.player_name}`}
        className="min-h-8 rounded-full bg-[#39ff14]/18 px-3 text-xs font-bold text-[#39ff14] disabled:opacity-60"
      >
        {busy ? "Swapping…" : label}
      </button>
      {error && <Small className="text-[#ff7a7a]">{error}</Small>}
    </span>
  );
}

type Problem = { starter: RosterEntry | null; text: string };

function lineupProblems(roster: RosterEntry[], slots: Record<string, number> | null, week: number | null): Problem[] {
  const problems: Problem[] = [];
  const starters = roster.filter((p) => isStarter(p.lineup_slot));
  for (const p of starters) {
    if (p.is_locked) continue;
    const status = p.injury_status?.toLowerCase() ?? "";
    if (week != null && p.bye_week === week) problems.push({ starter: p, text: `${p.player_name} is on bye` });
    else if (BAD_STATUS.includes(status)) problems.push({ starter: p, text: `${p.player_name} is ${p.injury_status}` });
  }
  if (slots) {
    for (const [slot, count] of Object.entries(slots)) {
      if (!isStarter(slot)) continue;
      const filled = starters.filter((p) => p.lineup_slot === slot).length;
      if (filled < count) problems.push({ starter: null, text: `Empty ${slot} spot` });
    }
  }
  return problems;
}

// Every problem in your lineup, with a one-click fix when a healthy backup sits on your bench.
export function LineupFixCard({
  roster,
  slots,
  week,
  color,
  onChanged,
}: {
  roster: RosterEntry[];
  slots: Record<string, number> | null;
  week: number | null;
  color: string;
  onChanged: () => void;
}) {
  const problems = lineupProblems(roster, slots, week);
  const questionable = roster.filter((p) => isStarter(p.lineup_slot) && !p.is_locked && p.injury_status?.toLowerCase() === "questionable");
  const set = problems.length === 0;
  return (
    <Panel tint={set ? color : WARN}>
      <div className="flex items-center justify-between gap-3">
        <Kicker color={set ? color : WARN}>{set ? "Lineup is set ✓" : `${problems.length} lineup problem${problems.length === 1 ? "" : "s"}`}</Kicker>
        <LinkText color={color} href="/team">
          Open lineup
        </LinkText>
      </div>
      <div>
        {problems.map((p, i) => {
          const backup = p.starter ? bestBackup(roster, p.starter, week) : null;
          return (
            <Row
              key={p.text}
              first={i === 0}
              left={
                <div className="flex flex-col gap-0.5">
                  <span>{p.text}</span>
                  {backup && (
                    <Small>
                      Best on your bench: {backup.player_name} · {fmt(proj(backup))}
                    </Small>
                  )}
                </div>
              }
              right={p.starter && backup ? <SwapButton starter={p.starter} backup={backup} label="Swap in" onChanged={onChanged} /> : <Chip color={WARN}>Fix</Chip>}
            />
          );
        })}
        {questionable.map((p, i) => (
          <Row
            key={p.player_id}
            first={problems.length === 0 && i === 0}
            left={
              <div className="flex flex-col gap-0.5">
                <span>
                  {p.player_name} · {p.position}
                </span>
                <Small>
                  {p.practice_participation ? `Practice: ${p.practice_participation}` : "No practice report yet"}
                  {p.game_time ? ` · ${when(p.game_time)}` : ""}
                </Small>
              </div>
            }
            right={<Chip color={HEADS_UP}>Questionable</Chip>}
          />
        ))}
      </div>
    </Panel>
  );
}

// Bench players projected within a couple of points of a starter at the same position.
export function StartSitCard({ roster, context, week, onChanged }: { roster: RosterEntry[]; context: MatchupContextSide | null; week: number | null; onChanged: () => void }) {
  const rank = new Map((context?.roster ?? []).map((p) => [String(p.player_id), p.opponent_position_rank]));
  const calls: { starter: RosterEntry; bench: RosterEntry }[] = [];
  for (const b of roster) {
    if (b.lineup_slot !== "BE" || b.is_locked || BAD_STATUS.includes(b.injury_status?.toLowerCase() ?? "") || (week != null && b.bye_week === week)) continue;
    const rival = roster.filter((s) => isStarter(s.lineup_slot) && !s.is_locked && s.position === b.position).sort((x, y) => proj(x) - proj(y))[0];
    if (rival && proj(b) > 0 && Math.abs(proj(rival) - proj(b)) <= 2.5) calls.push({ starter: rival, bench: b });
  }
  if (calls.length === 0) return null;
  const tough = (p: RosterEntry) => {
    const r = rank.get(p.player_id);
    return r ? `vs ${p.next_opponent ?? "?"} · ${r.rank}${r.rank === 1 ? "st" : r.rank === 2 ? "nd" : r.rank === 3 ? "rd" : "th"} toughest` : p.next_opponent ? `vs ${p.next_opponent}` : "";
  };
  const side = (p: RosterEntry, label: string, better: boolean, extra?: React.ReactNode) => (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-xl border bg-white/[0.04] p-2.5" style={{ borderColor: better ? "#39ff14" : "rgba(255,255,255,0.1)" }}>
      <span className="text-[10px] font-bold tracking-[0.1em] text-[#8790a0] uppercase">{label}</span>
      <span className="truncate text-sm font-bold">{p.player_name}</span>
      <span className="font-display text-[22px] tabular-nums">{fmt(proj(p))}</span>
      <Small className="truncate">{tough(p)}</Small>
      {extra}
    </div>
  );
  return (
    <Panel>
      <Kicker>Start / sit · your closest calls</Kicker>
      {calls.slice(0, 3).map(({ starter, bench }) => (
        <div key={`${starter.player_id}-${bench.player_id}`} className="flex gap-2.5">
          {side(starter, "Starting", proj(starter) >= proj(bench))}
          {side(bench, "Bench", proj(bench) > proj(starter), proj(bench) > proj(starter) ? <SwapButton starter={starter} backup={bench} label="Start him" onChanged={onChanged} /> : null)}
        </div>
      ))}
    </Panel>
  );
}

// Outdoor games with snow, rain, wind or freezing temperatures your
// starters play in, each on its own living weather (WeatherFx.tsx).
export function WeatherCard({ games, roster }: { games: NflGame[]; roster: RosterEntry[] }) {
  const mine = new Set(roster.filter((p) => isStarter(p.lineup_slot) && !p.is_locked && p.pro_team).map((p) => p.pro_team!));
  const alerts = games.filter((g) => {
    if (g.state !== "pre" || g.indoor || !g.weather) return false;
    if (!(mine.has(g.home_team ?? "") || mine.has(g.away_team ?? ""))) return false;
    const c = g.weather.condition?.toLowerCase() ?? "";
    return /snow|rain|storm|wind|sleet|shower/.test(c) || (g.weather.temperature != null && g.weather.temperature <= 32) || windy(g.weather);
  });
  if (alerts.length === 0) return null;
  return (
    <Panel tint="#4cc3ff">
      <Kicker color="#4cc3ff">Weather watch</Kicker>
      <div className="mt-2 flex flex-col gap-2">
        {alerts.map((g) => {
          const w = g.weather!;
          const yours = roster.filter((p) => isStarter(p.lineup_slot) && (p.pro_team === g.home_team || p.pro_team === g.away_team));
          const names = yours.map((p) => p.player_name).join(", ");
          const headline = [w.condition, w.temperature != null ? `${w.temperature}°` : null].filter(Boolean).join(" · ");
          const wind = windLine(w);
          return (
            <WeatherPane key={g.id} weather={w} label={`${g.away_team} at ${g.home_team}, ${headline}${wind ? `, ${wind}` : ""}. ${names}`}>
              <span className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-base">
                    {g.away_team} @ {g.home_team}
                  </span>
                  <Small className="truncate">{names}</Small>
                </span>
                <span className="flex shrink flex-col items-end gap-0.5 text-right">
                  <span className="text-sm font-bold">{headline}</span>
                  {wind && (
                    <span className="flex items-center gap-1 text-xs" style={{ color: windy(w) ? "#5ff2d6" : "#8790a0" }}>
                      {w.wind_dir != null && (
                        // Points where the wind is blowing to (wind_dir is where it comes from).
                        <span aria-hidden="true" className="inline-block font-bold" style={{ transform: `rotate(${(w.wind_dir + 180) % 360}deg)` }}>
                          ↑
                        </span>
                      )}
                      {wind}
                    </span>
                  )}
                </span>
              </span>
            </WeatherPane>
          );
        })}
      </div>
    </Panel>
  );
}

// The other side: their hurt starters, or who they start today.
export function OpponentIntelCard({ them, title, players }: { them: MatchupContextSide; title: string; players?: RosterPlayer[] }) {
  const hurt = them.roster.filter((p) => isStarter(p.lineup_slot) && p.injury_status && !["active", "healthy"].includes(p.injury_status.toLowerCase()));
  const list = players ?? hurt;
  if (list.length === 0) return null;
  return (
    <Panel>
      <Kicker>{title}</Kicker>
      <div>
        {list.map((p, i) => (
          <Row
            key={`${p.player_id}-${p.player_name}`}
            first={i === 0}
            left={`${p.player_name} · ${p.position ?? ""}`}
            right={players ? (p.on_bye ? "Bye week" : fmt(p.live_projected ?? p.points_projected)) : <Chip color={BAD_STATUS.includes(p.injury_status?.toLowerCase() ?? "") ? WARN : HEADS_UP}>{p.injury_status}</Chip>}
          />
        ))}
      </div>
    </Panel>
  );
}

// After Thursday: where you stand going into Sunday.
export function HeadStartCard({ matchup }: { matchup: YourWeekMatchup }) {
  const margin = (matchup.my_score ?? 0) - (matchup.opponent_score ?? 0);
  if ((matchup.my_score ?? 0) + (matchup.opponent_score ?? 0) === 0) return null;
  const up = margin >= 0;
  return (
    <Panel tint={up ? UP : WARN}>
      <Kicker color={up ? UP : WARN}>{up ? "Head start" : "Playing catch-up"}</Kicker>
      <p className="text-sm leading-5">
        You&apos;re {up ? "up" : "down"} {Math.abs(margin).toFixed(1)} going into Sunday ({fmt(matchup.my_score)}–{fmt(matchup.opponent_score)}), with {matchup.my_yet_to_play} left to their{" "}
        {matchup.opponent_yet_to_play}.
      </p>
    </Panel>
  );
}

const leftToScore = (p: RosterPlayer) => Math.max(0, (p.live_projected ?? p.points_projected ?? 0) - (p.points_scored ?? 0));
const stillToPlay = (side: MatchupContextSide) => side.roster.filter((p) => isStarter(p.lineup_slot) && p.game_status !== "final");

// Touchdowns on both sides this week.
export function TouchdownFeedCard({ me, them }: { me: MatchupContextSide; them: MatchupContextSide }) {
  const rows = [...me.touchdowns.map((t) => ({ ...t, mine: true })), ...them.touchdowns.map((t) => ({ ...t, mine: false }))].filter((t) => t.touchdowns > 0);
  if (rows.length === 0) return null;
  return (
    <Panel>
      <Kicker>Touchdowns this week</Kicker>
      <div>
        {rows.map((t, i) => (
          <Row
            key={`${t.mine}-${t.player_name}`}
            first={i === 0}
            left={
              <span>
                {t.player_name} <Small>{t.mine ? "yours" : `${them.owner_name}'s`}</Small>
              </span>
            }
            right={<Chip color={t.mine ? UP : DOWN}>{t.touchdowns > 1 ? `${t.touchdowns} TDs` : "TD"}</Chip>}
          />
        ))}
      </div>
    </Panel>
  );
}

// The player carrying you and the one hurting you most.
export function SwingPlayersCard({ me, them }: { me: MatchupContextSide; them: MatchupContextSide }) {
  const top = (side: MatchupContextSide) =>
    side.roster.filter((p) => isStarter(p.lineup_slot) && (p.points_scored ?? 0) > 0).sort((a, b) => (b.points_scored ?? 0) - (a.points_scored ?? 0))[0];
  const carry = top(me);
  const hurt = top(them);
  if (!carry && !hurt) return null;
  return (
    <div className="flex gap-2.5">
      {carry && (
        <Panel className="min-w-0 flex-1">
          <Kicker color={UP}>Carrying you</Kicker>
          <span className="truncate text-sm font-bold">{carry.player_name}</span>
          <span className="font-display text-[28px] tabular-nums">{fmt(carry.points_scored)}</span>
        </Panel>
      )}
      {hurt && (
        <Panel className="min-w-0 flex-1">
          <Kicker color={DOWN}>Hurting you</Kicker>
          <span className="truncate text-sm font-bold">{hurt.player_name}</span>
          <span className="font-display text-[28px] tabular-nums">{fmt(hurt.points_scored)}</span>
        </Panel>
      )}
    </div>
  );
}

// How many players each side has in each kickoff window.
export function GameWindowsCard({ me, them, now }: { me: MatchupContextSide; them: MatchupContextSide; now: Date }) {
  const windows = new Map<string, { at: number; label: string; mine: number; theirs: number; done: boolean; live: boolean }>();
  const add = (p: RosterPlayer, mine: boolean) => {
    if (!isStarter(p.lineup_slot) || !p.game_time) return;
    const t = new Date(p.game_time);
    const key = t.toISOString().slice(0, 13);
    const w = windows.get(key) ?? { at: t.getTime(), label: when(p.game_time), mine: 0, theirs: 0, done: true, live: false };
    if (mine) w.mine += 1;
    else w.theirs += 1;
    if (p.game_status !== "final") w.done = false;
    if (p.game_status === "in_progress") w.live = true;
    windows.set(key, w);
  };
  me.roster.forEach((p) => add(p, true));
  them.roster.forEach((p) => add(p, false));
  const rows = [...windows.values()].filter((w) => !w.done || w.at > now.getTime() - 12 * 3600_000).sort((a, b) => a.at - b.at);
  if (rows.length < 2) return null;
  return (
    <Panel>
      <Kicker>Game windows</Kicker>
      <div>
        {rows.map((w, i) => (
          <Row
            key={w.at}
            first={i === 0}
            left={
              <span className={w.done ? "text-[#8790a0]" : ""}>
                {w.label}
                {w.live ? <span className="text-xs font-bold text-red-500"> · live</span> : null}
              </span>
            }
            right={`You ${w.mine} · Them ${w.theirs}`}
          />
        ))}
      </div>
    </Panel>
  );
}

// The Monday math: how much your remaining players need to outscore theirs.
export function WhatYouNeedCard({ me, them, winProbability }: { me: MatchupContextSide; them: MatchupContextSide; winProbability: number | null }) {
  const margin = (me.score ?? 0) - (them.score ?? 0);
  const mine = stillToPlay(me);
  const theirs = stillToPlay(them);
  const myLeft = mine.reduce((s, p) => s + leftToScore(p), 0);
  const theirLeft = theirs.reduce((s, p) => s + leftToScore(p), 0);
  const need = theirLeft - margin;
  const color = margin >= 0 ? UP : DOWN;
  return (
    <Panel tint={color}>
      <Kicker color={color}>
        {margin >= 0 ? `You're up ${margin.toFixed(1)}` : `You're down ${Math.abs(margin).toFixed(1)}`} · {mine.length} left vs {theirs.length}
      </Kicker>
      {mine.length === 0 ? (
        <p className="text-sm">{theirs.length === 0 ? "Everyone has played." : `You're done. They need ${(-margin).toFixed(1)} to ${margin > 0 ? "catch you" : "stay ahead"}.`}</p>
      ) : (
        <>
          <p className="text-sm">{mine.length === 1 ? "Your last player needs" : `Your ${mine.length} players need`}</p>
          <span className="font-display text-[56px] leading-none font-semibold" style={{ color }}>
            {need <= 0 ? "Nothing" : `${need.toFixed(1)}+`}
          </span>
          <p className="text-sm">
            {need <= 0
              ? `You're ahead even if everyone hits projection — they need ${(margin + myLeft - theirLeft).toFixed(1)} more than projected to catch you.`
              : `to beat ${theirs.length === 0 ? "their final" : "their players' projection"} (projected to add ${myLeft.toFixed(1)})`}
          </p>
        </>
      )}
      <div>
        {[...mine.map((p) => ({ p, mine: true })), ...theirs.map((p) => ({ p, mine: false }))].map(({ p, mine: isMine }, i) => (
          <Row
            key={`${isMine}-${p.player_name}`}
            first={i === 0}
            left={
              <div className="flex flex-col gap-0.5">
                <span>
                  {p.player_name} <Small>{isMine ? "yours" : "theirs"}</Small>
                </span>
                <Small>{p.game_status === "in_progress" ? `Playing · ${fmt(p.points_scored)} so far` : when(p.game_time)}</Small>
              </div>
            }
            right={
              <span className="text-[13px] font-bold" style={{ color: isMine ? UP : DOWN }}>
                proj +{leftToScore(p).toFixed(1)}
              </span>
            }
          />
        ))}
      </div>
      {winProbability != null && (
        <span className="self-start">
          <Chip color={color}>{Math.round(winProbability)}% to win</Chip>
        </span>
      )}
    </Panel>
  );
}

type WinProbHistory = {
  points: { at: string; home_win_pct: number; home_score: number; away_score: number }[];
  turning_points: { at: string; home_win_pct_change: number; side: "home" | "away"; player_name: string | null; points: number }[];
};

// How the odds moved this week and what moved them. Click a bar, or drag
// across the chart, to read the odds at that moment.
export function TurningPointsCard({ history, meIsHome, opponent }: { history: WinProbHistory; meIsHome: boolean; opponent: string }) {
  const [picked, setPicked] = useState<number | null>(null);
  const dragging = useRef(false);
  const pts = history.points;
  if (pts.length < 2) return null;
  const mine = (pct: number) => (meIsHome ? pct : 100 - pct);
  const first = mine(pts[0].home_win_pct);
  const last = mine(pts[pts.length - 1].home_win_pct);
  const step = Math.max(1, Math.floor(pts.length / 40));
  const bars = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
  const barAt = (el: HTMLElement, clientX: number) => {
    const rect = el.getBoundingClientRect();
    const inner = rect.width - 8;
    return inner > 0 ? Math.min(bars.length - 1, Math.max(0, Math.floor(((clientX - rect.left - 4) / inner) * bars.length))) : null;
  };
  const at = picked !== null ? bars[picked] : null;
  return (
    <Panel>
      <Kicker>Win % this week</Kicker>
      <div className="flex items-center gap-3">
        <Big>{Math.round(last)}%</Big>
        <Chip color={last >= first ? UP : DOWN}>
          {last >= first ? "+" : "−"}
          {Math.abs(last - first).toFixed(0)} since kickoff
        </Chip>
      </div>
      <div
        role="img"
        aria-label={`Win chance went from ${Math.round(first)} to ${Math.round(last)} percent`}
        className="relative flex h-16 cursor-crosshair touch-pan-y items-end gap-px rounded-lg bg-white/[0.04] p-1 select-none"
        onPointerDown={(e) => {
          dragging.current = true;
          const i = barAt(e.currentTarget, e.clientX);
          if (i !== null) setPicked(i === picked ? null : i);
        }}
        onPointerMove={(e) => {
          if (!dragging.current && e.pointerType !== "mouse") return;
          if (e.pointerType === "mouse" && !dragging.current) return;
          const i = barAt(e.currentTarget, e.clientX);
          if (i !== null) setPicked(i);
        }}
        onPointerUp={() => (dragging.current = false)}
        onPointerLeave={() => (dragging.current = false)}
      >
        <div className="pointer-events-none absolute inset-x-1 top-1/2 h-px bg-[#8790a0]" />
        {bars.map((p, i) => {
          const v = mine(p.home_win_pct);
          return (
            <div
              key={p.at}
              className="flex-1 rounded-[1px]"
              style={{
                height: `${Math.max(3, v)}%`,
                backgroundColor: v >= 50 ? UP : DOWN,
                opacity: picked === null ? 0.85 : i === picked ? 1 : 0.35,
                outline: i === picked ? "1px solid #fff" : undefined,
              }}
            />
          );
        })}
      </div>
      {at ? (
        <div className="flex min-h-[22px] items-baseline gap-2">
          <span className="text-[17px] font-bold" style={{ color: mine(at.home_win_pct) >= 50 ? UP : DOWN }}>
            {Math.round(mine(at.home_win_pct))}%
          </span>
          <Small>
            {when(at.at)} · You {(meIsHome ? at.home_score : at.away_score).toFixed(1)} – {(meIsHome ? at.away_score : at.home_score).toFixed(1)} {opponent}
          </Small>
        </div>
      ) : (
        <Small className="min-h-[22px]">Click or drag across the bars to see your odds at any point</Small>
      )}
      <div>
        {history.turning_points.map((t, i) => {
          const forMe = (t.side === "home") === meIsHome;
          const change = meIsHome ? t.home_win_pct_change : -t.home_win_pct_change;
          return (
            <Row
              key={t.at}
              first={i === 0}
              left={
                <div className="flex flex-col gap-0.5">
                  <span>{t.player_name ? `${t.player_name} +${t.points.toFixed(1)}` : forMe ? "Your players scored" : `${opponent} scored`}</span>
                  <Small>{when(t.at)}</Small>
                </div>
              }
              right={<Chip color={change >= 0 ? UP : DOWN}>{`${change >= 0 ? "+" : "−"}${Math.abs(change).toFixed(0)}%`}</Chip>}
            />
          );
        })}
      </div>
    </Panel>
  );
}

// Every matchup around the league still undecided.
export function MatchupsAliveCard({ matchups, teamId }: { matchups: WeekMatchupContextItem[]; teamId: number }) {
  const alive = matchups.filter((m) => m.home.team_id !== teamId && m.away.team_id !== teamId && (stillToPlay(m.home).length > 0 || stillToPlay(m.away).length > 0));
  if (alive.length === 0) return null;
  return (
    <Panel>
      <Kicker>Still alive around the league</Kicker>
      <div>
        {alive.map((m, i) => {
          const diff = (m.home.score ?? 0) - (m.away.score ?? 0);
          const leader = diff >= 0 ? m.home : m.away;
          return (
            <Row
              key={m.matchup_id}
              first={i === 0}
              left={
                <span className="block truncate">
                  {m.home.owner_name} vs {m.away.owner_name}
                </span>
              }
              right={`${leader.owner_name} +${Math.abs(diff).toFixed(1)} · ${stillToPlay(m.home).length}v${stillToPlay(m.away).length} left`}
            />
          );
        })}
      </div>
    </Panel>
  );
}

// Tonight's NFL game(s): kickoff, channel, Gamecast.
export function TonightGamesCard({ games, title, findGamecastId }: { games: NflGame[]; title: string; findGamecastId: (home: string | null, away: string | null) => string | null }) {
  if (games.length === 0) return null;
  return (
    <Panel>
      <Kicker>{title}</Kicker>
      <div>
        {games.map((g, i) => {
          const id = findGamecastId(g.home_team, g.away_team);
          return (
            <Row
              key={g.id}
              first={i === 0}
              left={
                <div className="flex flex-col gap-0.5">
                  <span>
                    {g.away_team} @ {g.home_team}
                    {g.state === "in" ? <span className="text-xs font-bold text-red-500"> · {g.status_detail}</span> : null}
                  </span>
                  <Small>
                    {g.state === "in" ? `${g.away_score}–${g.home_score}` : g.date ? when(g.date) : g.status_detail}
                    {g.broadcast ? ` · ${g.broadcast}` : ""}
                  </Small>
                </div>
              }
              right={
                id ? (
                  <Link href={`/gamecast/${id}`} className="text-[13px] font-bold text-[#39ff14] hover:underline">
                    Gamecast →
                  </Link>
                ) : (
                  ""
                )
              }
            />
          );
        })}
      </div>
    </Panel>
  );
}

// Watch parties people are in right now.
export function WatchPartiesCard({ rooms }: { rooms: WatchPartyRoom[] }) {
  const live = rooms.filter((r) => r.is_live && r.member_count > 0);
  if (live.length === 0) return null;
  return (
    <Panel tint="#a78bfa" style={{ backgroundColor: "#1d1630" }}>
      <Kicker color="#c4b5fd">Watch parties on now</Kicker>
      <div>
        {live.map((r, i) => (
          <Row
            key={r.id}
            first={i === 0}
            left={r.name}
            right={
              <Link href="/lounge" className="text-[13px] font-bold text-[#c4b5fd] hover:underline">
                {r.member_count} watching · Join
              </Link>
            }
          />
        ))}
      </div>
    </Panel>
  );
}

export type { WinProbHistory };
