"use client";

import { useState } from "react";
import type {
  KeeperRules,
  LeagueActivityItem,
  MatchupContextSide,
  MyFreeAgent,
  PlayoffOdds,
  PowerRankTrendTeam,
  RosterEntry,
  RosterPlayer,
  StandingsRow,
  WaiverClaim,
  MyWaiverClaims,
  WeekMatchupContextItem,
  YourWeekMatchup,
} from "@/lib/api";
import type { Trade, TradeSettings } from "@/lib/tradesApi";
import { encodeScenario } from "@/lib/bracketEngine";
import { fmt, isStarter, nextEt, ordinal, untilText } from "@/lib/livingHome";
import { Big, Chip, DOWN, Kicker, LinkText, Panel, Row, Small, UP } from "@/components/living/LivingParts";
import { usePlayerCard } from "@/components/players/PlayerCardProvider";

// The Living Home's cards (the website's copy of the app's
// mobile/src/components/living/LivingCards.tsx and WeekCards.tsx).

const WHAT_IF = "#c084fc";
const MATTERS = 0.5;

function rankOf(rows: { team_id: number; wins: number; points_for: number }[], teamId: number): number {
  const sorted = [...rows].sort((a, b) => b.wins - a.wins || b.points_for - a.points_for);
  return sorted.findIndex((r) => r.team_id === teamId) + 1;
}

// "How the week ended": your MVP, your bench, the league's closest game.
export function WeekEndedCard({ me, closest }: { me: MatchupContextSide | null; closest: { label: string; margin: number } | null }) {
  const mvp = (me?.roster ?? [])
    .filter((p) => isStarter(p.lineup_slot) && p.points_scored != null)
    .sort((a, b) => (b.points_scored ?? 0) - (a.points_scored ?? 0))[0];
  const crime = me?.bench_crime;
  return (
    <Panel>
      <Kicker>How the week ended</Kicker>
      <div>
        {mvp && <Row first left="Your MVP" right={`${mvp.player_name} · ${fmt(mvp.points_scored)}`} />}
        <Row
          first={!mvp}
          left="Your bench"
          right={crime ? `${crime.bench_player} +${crime.points_diff.toFixed(1)} over ${crime.started_player}` : "No bench crimes"}
        />
        {closest && <Row left="Closest finish" right={`${closest.label} by ${closest.margin.toFixed(1)}`} />}
      </div>
    </Panel>
  );
}

// Waivers clear Wednesday 3:00 AM ET: the countdown, your spot, your claims.
export function WaiversCountdownCard({ claims, now, color }: { claims: MyWaiverClaims | null; now: Date; color: string }) {
  const clear = nextEt(3, 3, now);
  const pending = (claims?.claims ?? []).filter((c) => c.status === "pending");
  const priority = claims?.priority;
  return (
    <Panel tint={color} href="/free-agents" label="Your waiver claims">
      <Kicker color={color}>Waivers clear in</Kicker>
      <Big>{untilText(clear, now)}</Big>
      <span className="text-[13px] text-[#8790a0]">
        Wed 3:00 AM ET{priority ? ` · you're #${priority.rank} of ${priority.of} in the order` : ""}
      </span>
      <span className="text-sm font-bold" style={{ color }}>
        {pending.length === 0 ? "No claims yet · Find players →" : `${pending.length} claim${pending.length === 1 ? "" : "s"} in line · Rank them →`}
      </span>
    </Panel>
  );
}

// What the last waiver run did for you, then everyone else's moves from
// it: the first three, with the rest one click away.
export function ClaimResultsCard({ run, color, others = [] }: { run: WaiverClaim[]; color: string; others?: LeagueActivityItem[] }) {
  const won = run.filter((c) => c.status === "successful");
  const [showAll, setShowAll] = useState(false);
  const moves = others.filter((a): a is Extract<LeagueActivityItem, { kind: "roster" }> => a.kind === "roster");
  const shown = showAll ? moves : moves.slice(0, 3);
  return (
    <Panel tint={color}>
      <Kicker color={color}>Your claims · last run</Kicker>
      {run.length === 0 ? (
        <p className="text-sm">No claims ran for you this week.</p>
      ) : (
        <div>
          {run.map((c, i) => (
            <Row
              key={c.id}
              first={i === 0}
              left={
                <div className="flex flex-col gap-0.5">
                  <span>{c.status === "successful" ? `You got ${c.add_player_name}` : c.add_player_name}</span>
                  <Small>{c.status === "successful" ? (c.drop_player_name ? `Dropped ${c.drop_player_name}` : "No drop") : c.failure_reason}</Small>
                </div>
              }
              right={<Chip color={c.status === "successful" ? UP : DOWN}>{c.status === "successful" ? "Won" : "Lost"}</Chip>}
            />
          ))}
        </div>
      )}
      {moves.length > 0 && (
        <div className="flex flex-col gap-2 rounded-xl bg-white/[0.04] p-3">
          <div className="flex items-center justify-between">
            <Kicker>Everyone&apos;s moves</Kicker>
            <Small>{moves.length} overnight</Small>
          </div>
          {shown.map((a, i) => (
            <div key={`${a.owner_id}-${a.timestamp}-${i}`} className="flex items-center justify-between gap-2 text-[13px]">
              <span className="min-w-0 truncate">
                {a.owner_name} added {a.added_player_name ?? "a player"}
              </span>
              {a.dropped_player_name && <Small className="shrink-0">dropped {a.dropped_player_name}</Small>}
            </div>
          ))}
          {moves.length > 3 && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              aria-expanded={showAll}
              className="min-h-11 rounded-xl border border-white/10 text-sm font-semibold hover:border-white/25"
            >
              {showAll ? "Show fewer" : `Show all ${moves.length} moves`}
            </button>
          )}
        </div>
      )}
      {won.length > 0 ? (
        <LinkText color={color} href="/team">
          Set {won[0].add_player_name} in your lineup →
        </LinkText>
      ) : (
        <LinkText color={color} href="/free-agents">
          Browse free agents →
        </LinkText>
      )}
    </Panel>
  );
}

// Counting down to your next starter's kickoff.
export function KickoffCard({ players, now, color, title }: { players: RosterEntry[]; now: Date; color: string; title: string }) {
  const sorted = players.filter((p) => p.game_time).sort((a, b) => a.game_time!.localeCompare(b.game_time!));
  if (sorted.length === 0) return null;
  const first = sorted[0];
  const kickoff = new Date(first.game_time!);
  const together = sorted.filter((p) => p.game_time === first.game_time);
  return (
    <Panel tint={color}>
      <Kicker color={color}>{title}</Kicker>
      <Big>{untilText(kickoff, now)}</Big>
      <span className="text-[13px] text-[#8790a0]">
        {first.pro_team && first.next_opponent ? `${first.pro_team} vs ${first.next_opponent} · ` : ""}
        {kickoff.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}
      </span>
      <Row first left={`You start ${together.length} in that game`} right={together.map((p) => p.player_name.split(" ").slice(-1)[0]).join(", ")} />
    </Panel>
  );
}

// Live: your starters whose games are on right now.
export function PlayersNowCard({ players, title }: { players: RosterPlayer[]; title: string }) {
  if (players.length === 0) return null;
  return (
    <Panel>
      <Kicker>{title}</Kicker>
      <div>
        {players.map((p, i) => (
          <Row
            key={`${p.player_id}-${p.player_name}`}
            first={i === 0}
            left={
              <span className="truncate">
                {p.player_name}
                {p.is_redzone ? <span className="text-xs font-bold text-red-500"> · red zone</span> : null}
              </span>
            }
            right={<span className="font-display text-xl tabular-nums">{fmt(p.points_scored)}</span>}
          />
        ))}
      </div>
    </Panel>
  );
}

export function LoungeCard({ title, body }: { title: string; body: string }) {
  return (
    <Panel tint="#a78bfa" href="/lounge" label="Open the Lounge" style={{ backgroundColor: "#1d1630" }}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <Kicker color="#c4b5fd">{title}</Kicker>
          <span className="text-sm">{body}</span>
        </div>
        <Chip color="#a78bfa">Join</Chip>
      </div>
    </Panel>
  );
}

// Where this week's result moved you in the standings.
export function StandingsMoveCard({
  standings,
  matchups,
  teamId,
  week,
  playoffSpots = 4,
}: {
  standings: StandingsRow[];
  matchups: WeekMatchupContextItem[];
  teamId: number;
  week: number;
  playoffSpots?: number;
}) {
  const after = standings.map((r) => ({ team_id: r.team_id, wins: r.wins + r.ties / 2, points_for: Number(r.points_for) }));
  const mineRow = standings.find((r) => r.team_id === teamId);
  if (!mineRow || mineRow.wins + mineRow.losses + mineRow.ties < week) return null;
  const before = after.map((r) => ({ ...r }));
  for (const m of matchups) {
    const h = m.home.score ?? 0;
    const a = m.away.score ?? 0;
    const home = before.find((r) => r.team_id === m.home.team_id);
    const away = before.find((r) => r.team_id === m.away.team_id);
    if (!home || !away) continue;
    home.points_for -= h;
    away.points_for -= a;
    if (h > a) home.wins -= 1;
    else if (a > h) away.wins -= 1;
    else {
      home.wins -= 0.5;
      away.wins -= 0.5;
    }
  }
  const was = rankOf(before, teamId);
  const now = rankOf(after, teamId);
  const sorted = [...after].sort((x, y) => y.wins - x.wins || y.points_for - x.points_for);
  const cut = sorted[playoffSpots];
  const mine = after.find((r) => r.team_id === teamId)!;
  const cushion = cut ? mine.wins - cut.wins : null;
  const moved = was - now;
  return (
    <Panel href="/standings" label="Open the standings">
      <Kicker>What it did to the standings</Kicker>
      <div className="flex flex-wrap items-center gap-3">
        <Big>{ordinal(was)}</Big>
        <span className="text-2xl text-[#8790a0]">→</span>
        <Big color={moved > 0 ? UP : moved < 0 ? DOWN : undefined}>{ordinal(now)}</Big>
        <Chip color={moved > 0 ? UP : moved < 0 ? DOWN : "#8790a0"}>{moved > 0 ? `Up ${moved}` : moved < 0 ? `Down ${-moved}` : "Held"}</Chip>
      </div>
      {cushion !== null && now <= playoffSpots && (
        <span className="text-[13px] text-[#8790a0]">
          {cushion >= 1 ? `${cushion} game${cushion === 1 ? "" : "s"} clear of ${ordinal(playoffSpots + 1)}` : `Level with ${ordinal(playoffSpots + 1)} on wins`}
        </span>
      )}
      {now > playoffSpots && cut && (
        <span className="text-[13px] text-[#8790a0]">{(sorted[playoffSpots - 1].wins - mine.wins).toFixed(0)} game(s) back of the last playoff spot</span>
      )}
    </Panel>
  );
}

// "You beat your projection by 12.4", points rank, overachiever and dud.
export function ProjectionReportCard({ me, matchups }: { me: MatchupContextSide; matchups: WeekMatchupContextItem[] }) {
  const score = me.score ?? 0;
  const projected = me.pregame_projected_total;
  const scores = matchups.flatMap((m) => [m.home.score ?? 0, m.away.score ?? 0]).sort((a, b) => b - a);
  const rank = scores.indexOf(score) + 1;
  const starters = me.roster.filter((p) => isStarter(p.lineup_slot) && p.points_projected != null && p.points_scored != null);
  const diff = (p: RosterPlayer) => (p.points_scored ?? 0) - (p.points_projected ?? 0);
  const best = [...starters].sort((a, b) => diff(b) - diff(a))[0];
  const worst = [...starters].sort((a, b) => diff(a) - diff(b))[0];
  return (
    <Panel>
      <Kicker>Report card</Kicker>
      <div>
        {projected != null && (
          <Row
            first
            left="Vs. your projection"
            right={
              <span className="font-semibold" style={{ color: score >= projected ? UP : DOWN }}>
                {score >= projected ? "+" : "−"}
                {Math.abs(score - projected).toFixed(1)}
              </span>
            }
          />
        )}
        {rank > 0 && <Row first={projected == null} left="Points this week" right={`${ordinal(rank)} of ${scores.length}`} />}
        {best && diff(best) > 0 && <Row left="Overachiever" right={`${best.player_name} +${diff(best).toFixed(1)}`} />}
        {worst && diff(worst) < 0 && <Row left="Dud" right={`${worst.player_name} ${diff(worst).toFixed(1)}`} />}
      </div>
    </Panel>
  );
}

// Every matchup's score, your game first, with upsets and blowouts called out.
export function LeagueScoreboardCard({ matchups, teamId, title, live }: { matchups: WeekMatchupContextItem[]; teamId: number; title: string; live?: boolean }) {
  const mineFirst = (m: WeekMatchupContextItem) => (m.home.team_id === teamId || m.away.team_id === teamId ? 0 : 1);
  const rows = [...matchups].sort((x, y) => mineFirst(x) - mineFirst(y));
  if (rows.length === 0) return null;
  const closest = live
    ? [...rows].sort((a, b) => Math.abs((a.home.score ?? 0) - (a.away.score ?? 0)) - Math.abs((b.home.score ?? 0) - (b.away.score ?? 0)))[0]
    : null;
  return (
    <Panel>
      <Kicker>{title}</Kicker>
      <div>
        {rows.map((m, i) => {
          const h = m.home.score ?? 0;
          const a = m.away.score ?? 0;
          const [win, lose] = h >= a ? [m.home, m.away] : [m.away, m.home];
          const margin = Math.abs(h - a);
          const upset = !live && win.power_rank != null && lose.power_rank != null && win.power_rank - lose.power_rank >= 3;
          const tag = upset ? "Upset" : !live && margin >= 40 ? "Blowout" : closest === m ? "Closest" : null;
          const yours = mineFirst(m) === 0;
          return (
            <Row
              key={m.matchup_id}
              first={i === 0}
              left={
                <span className={`block truncate ${yours ? "font-bold" : ""}`}>
                  {win.owner_name} {fmt(win.score)} – {fmt(lose.score)} {lose.owner_name}
                </span>
              }
              right={
                tag ? (
                  <Chip color={tag === "Upset" ? "#f5b942" : tag === "Closest" ? "#4cc3ff" : DOWN}>{tag}</Chip>
                ) : yours ? (
                  <Chip color={UP}>You</Chip>
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

// A rivalry game's updated all-time series.
export function RivalryResultCard({ item, teamId }: { item: WeekMatchupContextItem; teamId: number }) {
  if (!item.is_rivalry || !item.rivalry) return null;
  const meHome = item.home.team_id === teamId;
  const mine = meHome ? item.rivalry.all_time_wins_home : item.rivalry.all_time_wins_away;
  const theirs = meHome ? item.rivalry.all_time_wins_away : item.rivalry.all_time_wins_home;
  return (
    <Panel tint="#f5b942">
      <Kicker color="#f5b942">
        {item.rivalry.emoji ? `${item.rivalry.emoji} ` : ""}
        {item.rivalry.name}
      </Kicker>
      <p className="text-sm">
        All-time series now {mine}–{theirs}
        {mine > theirs ? ", your way" : mine < theirs ? ", their way" : ", all square"}
      </p>
    </Panel>
  );
}

// Your power ranking now and how far it moved.
export function PowerMoveCard({ trend, teamId }: { trend: PowerRankTrendTeam[]; teamId: number }) {
  const mine = trend.find((t) => t.team_id === teamId);
  const weeks = mine?.weeks ?? [];
  if (weeks.length === 0) return null;
  const now = weeks[weeks.length - 1];
  const prev = weeks.length > 1 ? weeks[weeks.length - 2] : null;
  const moved = prev ? prev.power_rank - now.power_rank : 0;
  return (
    <Panel href="/power-rankings" label="Open power rankings">
      <Kicker>Power rankings</Kicker>
      <div className="flex flex-wrap items-center gap-3">
        <Big>#{now.power_rank}</Big>
        {prev && <Chip color={moved > 0 ? UP : moved < 0 ? DOWN : "#8790a0"}>{moved > 0 ? `Up ${moved}` : moved < 0 ? `Down ${-moved}` : "No change"}</Chip>}
      </div>
      <div className="flex h-14 items-end gap-1.5" aria-label={`Power rank by week: ${weeks.map((w) => w.power_rank).join(", ")}`}>
        {weeks.map((w) => (
          <div key={w.week} className="flex flex-col items-center gap-0.5">
            <div className="w-3.5 rounded-[3px]" style={{ height: Math.max(4, 40 - (w.power_rank - 1) * 3), backgroundColor: w === now ? UP : "#1e2227" }} />
            <span className="text-[9px] text-[#8790a0]">{w.week}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// The What-If engine's read on this week: "odds" (Tuesday–Saturday) is
// your playoff chances and what this week's result does to them; "root"
// (Sunday–Monday) is the other games to root for.
export function WhatIfCard({ odds, teamId, standings, half }: { odds: PlayoffOdds; teamId: number; standings: StandingsRow[]; half: "odds" | "root" }) {
  const mine = odds.teams.find((t) => t.team_id === teamId);
  const focus = odds.focus?.team_id === teamId ? odds.focus : null;
  if (!mine || !focus || focus.games_left === 0) return null;
  const name = (id: number) => standings.find((r) => r.team_id === id)?.team_name ?? "TBD";
  const next = focus.next_game;
  const thisWeek = (focus as typeof focus & { root_this_week?: typeof focus.root_for }).root_this_week;
  const games = (thisWeek ?? focus.root_for.filter((r) => r.week === next?.week)).filter((r) => r.swing >= MATTERS);
  const shown = games.slice(0, 4);
  const pct = (n: number) => `${Math.round(n)}%`;
  const picks: Record<number, number> = {};
  if (next) picks[next.matchup_id] = teamId;
  for (const r of games) picks[r.matchup_id] = r.root_for_team_id;
  const href = `/standings?view=playoffs&mode=whatif&w=${encodeURIComponent(encodeScenario({ flips: [], picks, playoff: {} }, teamId))}`;
  return (
    <Panel tint={WHAT_IF} href={href} label="Play out this week in What-If">
      <Kicker color={WHAT_IF}>{half === "odds" ? "What-If · Your playoff picture" : "What-If · Root for this week"}</Kicker>
      {half === "odds" ? (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Big>{pct(mine.playoff_pct)}</Big>
            <span className="text-[13px] text-[#8790a0]">to make the playoffs right now</span>
          </div>
          {next && next.if_win_pct != null && next.if_loss_pct != null && (
            <div className="flex gap-2">
              <div className="flex flex-1 flex-col gap-0.5 rounded-xl border bg-white/[0.04] p-2.5" style={{ borderColor: `${UP}55` }}>
                <Small>Beat {name(next.opponent_team_id)}</Small>
                <span className="text-[22px] font-extrabold tabular-nums" style={{ color: UP }}>
                  {pct(next.if_win_pct)}
                </span>
              </div>
              <div className="flex flex-1 flex-col gap-0.5 rounded-xl border bg-white/[0.04] p-2.5" style={{ borderColor: `${DOWN}55` }}>
                <Small>Lose</Small>
                <span className="text-[22px] font-extrabold tabular-nums" style={{ color: DOWN }}>
                  {pct(next.if_loss_pct)}
                </span>
              </div>
            </div>
          )}
        </>
      ) : shown.length === 0 ? (
        <p className="text-sm">No other game this week moves your odds much. It&apos;s all on your own matchup.</p>
      ) : (
        <div>
          {shown.map((r, i) => (
            <Row
              key={r.matchup_id}
              first={i === 0}
              left={
                <div className="flex flex-col gap-0.5">
                  <span className="truncate">
                    <b>{name(r.root_for_team_id)}</b> <Small>over {name(r.against_team_id)}</Small>
                  </span>
                  <Small>
                    {i === 0 ? "Your biggest game outside your own · " : ""}
                    {pct(r.pct_if_root)} if they win, {pct(r.pct_if_other)} if not
                  </Small>
                </div>
              }
              right={<Chip color={i === 0 ? WHAT_IF : UP}>{`+${r.swing.toFixed(1)}%`}</Chip>}
            />
          ))}
        </div>
      )}
      <span className="text-sm font-bold" style={{ color: WHAT_IF }}>
        Play out the week in What-If →
      </span>
    </Panel>
  );
}

// This week's opponent: record, form, power rank and your history.
export function NextOpponentCard({ matchup, item, teamId }: { matchup: YourWeekMatchup; item: WeekMatchupContextItem | null; teamId: number }) {
  const h2h = item?.head_to_head;
  const meHome = item?.home.team_id === teamId;
  const myWins = h2h ? (meHome ? h2h.wins_home : h2h.wins_away) : 0;
  const theirWins = h2h ? (meHome ? h2h.wins_away : h2h.wins_home) : 0;
  return (
    <Panel href={`/matchups/${matchup.matchup_id}`} label="Open this week's matchup">
      <Kicker>Up next</Kicker>
      <span className="text-[17px] font-bold">{matchup.opponent_team_name}</span>
      <div>
        <Row first left="Record" right={`${matchup.opponent_record ?? "–"}${matchup.opponent_result_streak ? ` · ${matchup.opponent_result_streak}` : ""}`} />
        {matchup.opponent_power_rank != null && <Row left="Power rank" right={`#${matchup.opponent_power_rank}`} />}
        {h2h && myWins + theirWins + h2h.ties > 0 && (
          <Row
            left="Head to head"
            right={`You ${myWins}–${theirWins}${h2h.ties ? `–${h2h.ties}` : ""}${h2h.last_season ? ` · last met ${h2h.last_season} Wk ${h2h.last_week}` : ""}`}
          />
        )}
        <Row left="Projected" right={`${fmt(matchup.my_projected_total)} – ${fmt(matchup.opponent_projected_total)}`} />
      </div>
    </Panel>
  );
}

// Who got hurt Sunday and who's on the report now.
export function InjuryReportCard({ lastWeek, roster, title }: { lastWeek: RosterPlayer[]; roster: RosterEntry[]; title: string }) {
  const hurtInGame = lastWeek.filter((p) => p.in_game_injury && p.in_game_injury.state !== "returned");
  const listed = roster.filter((p) => p.injury_status && !["active", "healthy"].includes(p.injury_status.toLowerCase()));
  if (hurtInGame.length === 0 && listed.length === 0) return null;
  const color = (status: string) => (["out", "ir", "injured reserve", "doubtful", "suspended", "pup"].includes(status.toLowerCase()) ? DOWN : "#f5b942");
  return (
    <Panel href="/team" label="Open your roster">
      <Kicker>{title}</Kicker>
      <div>
        {hurtInGame.map((p, i) => (
          <Row key={`g${p.player_name}`} first={i === 0} left={`${p.player_name} left his game`} right={<Chip color={DOWN}>{p.in_game_injury?.detail ?? "Hurt"}</Chip>} />
        ))}
        {listed.map((p, i) => (
          <Row
            key={p.player_id}
            first={hurtInGame.length === 0 && i === 0}
            left={
              <div className="flex flex-col gap-0.5">
                <span>
                  {p.player_name} · {p.position}
                  {!isStarter(p.lineup_slot) ? " (bench)" : ""}
                </span>
                {p.practice_participation ? <Small>Practice: {p.practice_participation}</Small> : null}
              </div>
            }
            right={<Chip color={color(p.injury_status!)}>{p.injury_status}</Chip>}
          />
        ))}
      </div>
    </Panel>
  );
}

// Free agents worth a look: by last week's points, or this week's projection.
export function FreeAgentsCard({ players, by, title, color }: { players: MyFreeAgent[]; by: "last" | "projected"; title: string; color: string }) {
  const value = (p: MyFreeAgent) => (by === "last" ? p.last_week_score : p.projected_points) ?? 0;
  const top = players.filter((p) => !p.rostered_team_id && value(p) > 0).sort((a, b) => value(b) - value(a)).slice(0, 4);
  const { openPlayerCard } = usePlayerCard();
  if (top.length === 0) return null;
  return (
    <Panel>
      <Kicker>{title}</Kicker>
      <div>
        {top.map((p, i) => (
          // Each player opens their card, where you can claim or add them.
          <button
            key={p.sleeper_player_id}
            type="button"
            onClick={() => openPlayerCard(p.sleeper_player_id)}
            className="block w-full cursor-pointer text-left hover:opacity-80"
          >
          <Row
            first={i === 0}
            left={
              <div className="flex flex-col gap-0.5">
                <span>
                  {p.full_name}{" "}
                  <Small>
                    {p.position}
                    {p.pro_team ? ` · ${p.pro_team}` : ""}
                  </Small>
                </span>
                <Small>{p.waiver_clears_at || p.game_locked ? "On waivers · claim" : "Free agent · add now"}</Small>
              </div>
            }
            right={<span className="font-display text-xl tabular-nums">{value(p).toFixed(1)}</span>}
          />
          </button>
        ))}
      </div>
      <LinkText color={color} href="/free-agents">
        All free agents →
      </LinkText>
    </Panel>
  );
}

// Which side wins each position on paper this week.
export function PositionEdgeCard({ me, them }: { me: MatchupContextSide; them: MatchupContextSide }) {
  const total = (side: MatchupContextSide) => {
    const byPos = new Map<string, number>();
    for (const p of side.roster) {
      if (!isStarter(p.lineup_slot) || !p.position) continue;
      const pos = p.position === "DST" ? "DEF" : p.position;
      byPos.set(pos, (byPos.get(pos) ?? 0) + (p.live_projected ?? p.points_projected ?? 0));
    }
    return byPos;
  };
  const mine = total(me);
  const theirs = total(them);
  const positions = ["QB", "RB", "WR", "TE", "K", "DEF"].filter((p) => mine.has(p) || theirs.has(p));
  if (positions.length === 0) return null;
  const wins = positions.filter((p) => (mine.get(p) ?? 0) > (theirs.get(p) ?? 0)).length;
  return (
    <Panel>
      <Kicker>
        Position by position · you win {wins} of {positions.length}
      </Kicker>
      <div className="flex flex-wrap gap-2">
        {positions.map((p) => {
          const a = mine.get(p) ?? 0;
          const b = theirs.get(p) ?? 0;
          return (
            <div key={p} className="flex min-w-[52px] flex-1 flex-col items-center gap-0.5 rounded-[10px] bg-white/[0.04] p-2">
              <Small>{p}</Small>
              <span className="text-[15px] font-extrabold tabular-nums" style={{ color: a > b ? UP : a < b ? DOWN : undefined }}>
                {a > b ? "+" : a < b ? "−" : ""}
                {Math.abs(a - b).toFixed(1)}
              </span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

// Trade offers waiting on you, or on them.
export function TradesCard({ trades, teamId, color }: { trades: Trade[]; teamId: number; color: string }) {
  const open = trades.filter((t) => ["pending", "awaiting_review", "in_review"].includes(t.status));
  if (open.length === 0) return null;
  return (
    <Panel tint={color} href="/trades" label="Open trades">
      <Kicker color={color}>Trades</Kicker>
      <div>
        {open.map((t, i) => (
          <Row
            key={t.id}
            first={i === 0}
            left={t.receiving_team_id === teamId ? `Offer from ${t.proposing_team_name ?? "a team"}` : `Your offer to ${t.receiving_team_name ?? "a team"}`}
            right={<Chip color={color}>{t.receiving_team_id === teamId && t.status === "pending" ? "Review" : t.status === "pending" ? "Waiting" : "In review"}</Chip>}
          />
        ))}
      </div>
    </Panel>
  );
}

// Your byes over the next three weeks and who covers them.
export function ByePlannerCard({ roster, week }: { roster: RosterEntry[]; week: number }) {
  const rows = [week, week + 1, week + 2]
    .map((w) => ({ week: w, out: roster.filter((p) => p.bye_week === w && isStarter(p.lineup_slot)) }))
    .filter((r) => r.out.length > 0);
  if (rows.length === 0) return null;
  return (
    <Panel>
      <Kicker>Bye weeks ahead</Kicker>
      <div>
        {rows.map((r, i) => {
          const covers = r.out.map((p) => {
            const backup = roster
              .filter((b) => !isStarter(b.lineup_slot) && b.position === p.position && b.bye_week !== r.week)
              .sort((a, b) => (b.points_projected ?? 0) - (a.points_projected ?? 0))[0];
            return `${p.player_name.split(" ").slice(-1)[0]} (${backup ? backup.player_name.split(" ").slice(-1)[0] : "no backup"})`;
          });
          return (
            <Row
              key={r.week}
              first={i === 0}
              left={`Week ${r.week}`}
              right={
                <span className="text-right font-semibold" style={{ color: covers.some((c) => c.includes("no backup")) ? DOWN : undefined }}>
                  {covers.join(", ")}
                </span>
              }
            />
          );
        })}
      </div>
    </Panel>
  );
}

// Trade and keeper deadlines coming up within a week.
export function DeadlinesCard({ trade, keeper, now }: { trade: TradeSettings | null; keeper: KeeperRules | null; now: Date }) {
  const soon = (iso: string | null | undefined) => {
    if (!iso) return null;
    const t = new Date(iso);
    const ms = t.getTime() - now.getTime();
    return ms > 0 && ms < 7 * 24 * 60 * 60 * 1000 ? t : null;
  };
  const tradeAt = soon(trade?.trade_deadline);
  const keeperAt = keeper?.is_open ? soon(keeper.keeper_deadline) : null;
  if (!tradeAt && !keeperAt) return null;
  return (
    <Panel tint={DOWN}>
      <Kicker color={DOWN}>Deadlines</Kicker>
      <div>
        {tradeAt && <Row first left="Trade deadline" right={`in ${untilText(tradeAt, now)}`} />}
        {keeperAt && <Row first={!tradeAt} left="Keeper deadline" right={`in ${untilText(keeperAt, now)}`} />}
      </div>
    </Panel>
  );
}
