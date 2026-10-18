"use client";

import { useState } from "react";
import type { MatchupContextSide, RosterPlayer, WeekMatchupContextItem, YourWeek } from "@/lib/api";
import { BetAvatar } from "@/components/bets/league/LeagueBetParts";
import type { Bet, BetMember, LeagueBet } from "@/lib/betsApi";
import { formatGameTime } from "@/lib/gameTime";
import { formatStatLine } from "@/lib/statLine";

// The Lounge's My Sweat panel, matching the native app's sweat sheet
// (mobile/src/components/lounge/LoungeSweat.tsx): Matchup (both scores,
// projections, your starters playing now and still to play), Bets, and
// the league Scoreboard. Tapping a team there, or either name in
// Matchup, opens its lineup right in the panel. Everything here is held
// back by the room's delay, like the rest of the room.

const fmt = (n: number | null | undefined) => (n ?? 0).toFixed(1);
const RESERVE = ["BE", "IR", "TAXI"];
const isStarter = (p: RosterPlayer) => !RESERVE.includes(p.lineup_slot ?? "");
const SLOT_LABELS: Record<string, string> = { "RB/WR/TE": "FLEX", "QB/RB/WR/TE": "SFLEX", BE: "BN" };

function positionLabel(p: RosterPlayer): string {
  return p.position === "DEF" ? "D/ST" : (p.position ?? "");
}

function statusLine(p: RosterPlayer): string {
  const line = formatStatLine(p.raw_stats);
  if (line) return `${positionLabel(p)} · ${line}`;
  if (p.on_offense) return `${positionLabel(p)} · ${p.pro_team} ball, on the field`;
  if (p.is_redzone) return `${positionLabel(p)} · ${p.pro_team} in the red zone`;
  return `${positionLabel(p)} · ${p.pro_team ?? ""}`;
}

function upcomingLine(p: RosterPlayer): string {
  if (p.on_bye) return "Bye week";
  return `${p.pro_team ?? ""}${p.game_time ? ` · ${formatGameTime(p.game_time)}` : ""}`;
}

function leftLine(side: MatchupContextSide): string {
  const starters = side.roster.filter(isStarter);
  const live = starters.filter((p) => p.game_status === "in_progress").length;
  const toGo = starters.filter((p) => (p.game_status === "scheduled" || p.game_status === null) && !p.on_bye).length;
  if (live + toGo === 0) return "Done";
  return [live ? `${live} playing` : null, toGo ? `${toGo} to go` : null].filter(Boolean).join(" · ");
}

function Avatar({ side, size = 34 }: { side: MatchupContextSide; size?: number }) {
  const name = side.owner_name || side.team_name;
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return side.logo_url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={side.logo_url} alt="" width={size} height={size} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <span className="flex shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-bold" style={{ width: size, height: size }} aria-hidden>
      {initials}
    </span>
  );
}

export function LoungeSweatPanel({
  week,
  league,
  bets,
  leagueBets,
  myOwnerId,
  accent,
}: {
  week: YourWeek | undefined;
  league: WeekMatchupContextItem[];
  bets: Bet[];
  // Everyone else's open bets (League Bets).
  leagueBets: LeagueBet[];
  myOwnerId: number;
  accent: string;
}) {
  const [tab, setTab] = useState<"matchup" | "bets" | "scoreboard">("matchup");
  const [betsView, setBetsView] = useState<"mine" | "league">("mine");
  const [rosterTeamId, setRosterTeamId] = useState<number | null>(null);
  const m = week?.matchup ?? null;
  const mine = league.find((x) => x.matchup_id === m?.matchup_id) ?? null;
  const mySide = mine ? (mine.home.owner_id === myOwnerId ? mine.home : mine.away) : null;
  const theirSide = mine && mySide ? (mySide === mine.home ? mine.away : mine.home) : null;
  const rosterSide =
    rosterTeamId === null ? null : league.flatMap((x) => [x.home, x.away]).find((s) => s.team_id === rosterTeamId) ?? null;
  const scoreboard = mine ? [mine, ...league.filter((x) => x !== mine)] : league;
  const myStarters = (mySide?.roster ?? []).filter(isStarter);
  const playing = myStarters.filter((p) => p.game_status === "in_progress");
  const toPlay = myStarters.filter((p) => p.game_status === "scheduled" || p.game_status === null);
  const open = bets.filter((b) => b.status === "open");

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div role="tablist" aria-label="My Sweat" className="flex gap-1.5">
        {(["matchup", "bets", "scoreboard"] as const).map((id) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => {
              setTab(id);
              setRosterTeamId(null);
            }}
            className="h-8 flex-1 rounded-full text-xs font-bold"
            style={tab === id ? { background: "rgba(255,255,255,0.12)", color: "#f3f4f6" } : { border: "1px solid rgba(255,255,255,0.1)", color: "#9aa3b2" }}
          >
            {id === "matchup" ? "Matchup" : id === "bets" ? "Bets" : "Scoreboard"}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto">
        {rosterSide ? (
          <TeamRoster side={rosterSide} accent={accent} onBack={() => setRosterTeamId(null)} />
        ) : tab === "matchup" ? (
          m ? (
            <>
              <div className="flex items-center justify-between gap-2 rounded-[14px] border border-white/[0.08] bg-[#161a24] p-3">
                <button
                  disabled={!mySide}
                  onClick={() => mySide && setRosterTeamId(mySide.team_id)}
                  className="flex min-w-0 flex-1 flex-col items-start text-left disabled:cursor-default"
                  aria-label={`${week?.team_name ?? "Your team"}, see roster`}
                >
                  <span className={`max-w-full truncate text-xs ${mySide ? "font-semibold text-[#f3f4f6] hover:underline" : "text-[#9aa3b2]"}`}>
                    {week?.team_name} · you{mySide ? " ›" : ""}
                  </span>
                  <b className="font-mono text-2xl">{fmt(m.my_score)}</b>
                  <span className="text-[11px] text-[#9aa3b2]">proj {fmt(m.my_projected_total)}</span>
                </button>
                <div className="flex flex-col items-center px-1">
                  <b className="font-mono text-xl" style={{ color: accent }}>
                    {m.win_probability !== null && m.win_probability !== undefined ? `${Math.round(m.win_probability)}%` : "—"}
                  </b>
                  <span className="text-[10px] tracking-wider text-[#9aa3b2]">TO WIN</span>
                </div>
                <button
                  disabled={!theirSide}
                  onClick={() => theirSide && setRosterTeamId(theirSide.team_id)}
                  className="flex min-w-0 flex-1 flex-col items-end text-right disabled:cursor-default"
                  aria-label={`${m.opponent_team_name ?? "Opponent"}, see roster`}
                >
                  <span className={`max-w-full truncate text-xs ${theirSide ? "font-semibold text-[#f3f4f6] hover:underline" : "text-[#9aa3b2]"}`}>
                    {m.opponent_team_name}
                    {theirSide ? " ›" : ""}
                  </span>
                  <b className="font-mono text-2xl">{fmt(m.opponent_score)}</b>
                  <span className="text-[11px] text-[#9aa3b2]">proj {fmt(m.opponent_projected_total)}</span>
                </button>
              </div>
              {playing.length > 0 && <SectionLabel>PLAYING NOW</SectionLabel>}
              {playing.map((p) => (
                <PlayerRow key={String(p.player_id ?? p.player_name)} p={p} dot={p.is_redzone ? "#f87171" : accent} status={statusLine(p)} value={fmt(p.points_scored)} />
              ))}
              {toPlay.length > 0 && <SectionLabel>STILL TO PLAY</SectionLabel>}
              {toPlay.map((p) => (
                <PlayerRow
                  key={String(p.player_id ?? p.player_name)}
                  p={p}
                  dot="#4b5263"
                  status={upcomingLine(p)}
                  value={p.on_bye ? "—" : `proj ${fmt(p.points_projected)}`}
                  muted
                />
              ))}
            </>
          ) : (
            <p className="py-6 text-center text-sm text-[#9aa3b2]">No matchup this week yet.</p>
          )
        ) : tab === "bets" ? (
          <>
            <div role="tablist" aria-label="Whose bets" className="flex self-center rounded-full border border-white/[0.08] bg-[#161a24] p-[3px]">
              {(["mine", "league"] as const).map((id) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={betsView === id}
                  onClick={() => setBetsView(id)}
                  className={`rounded-full px-4 py-1.5 text-[13px] font-bold ${betsView === id ? "bg-white/[0.14] text-[#f3f4f6]" : "text-[#9aa3b2]"}`}
                >
                  {id === "mine" ? "Mine" : `League${leagueBets.length ? ` · ${leagueBets.length}` : ""}`}
                </button>
              ))}
            </div>
            {betsView === "mine" ? (
              open.length === 0 ? (
                <p className="py-6 text-center text-sm text-[#9aa3b2]">No open bets. Add one from Bets.</p>
              ) : (
                open.map((b) => <SweatBet key={b.id} bet={b} accent={accent} />)
              )
            ) : leagueBets.length === 0 ? (
              <p className="py-6 text-center text-sm text-[#9aa3b2]">No one else in the league has an open bet right now.</p>
            ) : (
              leagueBets.map((b) => <SweatBet key={b.id} bet={b} member={b.member} accent={accent} />)
            )}
          </>
        ) : scoreboard.length === 0 ? (
          <p className="py-6 text-center text-sm text-[#9aa3b2]">No matchups this week yet.</p>
        ) : (
          scoreboard.map((x) => <ScoreboardCard key={x.matchup_id} item={x} mine={x === mine} accent={accent} onOpenTeam={setRosterTeamId} />)
        )}
      </div>
    </div>
  );
}

/** An open bet's legs with how close each is; a league-mate's shows who placed it. */
function SweatBet({ bet, member, accent }: { bet: Bet; member?: BetMember; accent: string }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-[14px] border bg-[#161a24] p-3 text-[13px]" style={{ borderColor: "rgba(96,165,250,0.35)" }}>
      {member && (
        <div className="flex items-center gap-2">
          <BetAvatar member={member} size={22} />
          <b className="truncate text-[13px]">{member.name}</b>
        </div>
      )}
      <div className="flex items-center justify-between">
        <b className="text-sm">{bet.legs.length > 1 ? `${bet.legs.length}-leg parlay` : "Straight bet"}</b>
        {bet.payout ? <span className="font-mono text-[#93c5fd]">to win ${bet.payout.toFixed(0)}</span> : null}
      </div>
      {bet.legs.map((leg) => {
        const pct = leg.status === "won" ? 100 : leg.current !== null && leg.target ? Math.min(100, (leg.current / leg.target) * 100) : 0;
        const color = leg.status === "won" ? accent : leg.status === "lost" ? "#f87171" : "#93c5fd";
        return (
          <div key={leg.id} className="flex flex-col gap-1">
            <div className="flex justify-between gap-2">
              <span className="truncate">{leg.description}</span>
              <span className="font-mono" style={{ color }}>
                {leg.status === "won" ? "Hit" : leg.status === "lost" ? "Missed" : leg.current !== null ? `${leg.current} / ${leg.target ?? leg.line ?? ""}` : "Live"}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[#2b2f3a]">
              <div className="h-full" style={{ width: `${pct}%`, background: color }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <span className="font-display text-[11px] font-semibold tracking-[1.2px] text-[#9aa3b2]">{children}</span>;
}

function PlayerRow({ p, dot, status, value, muted }: { p: RosterPlayer; dot: string; status: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl bg-[#161a24] px-3 py-2.5">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: dot }} />
      <div className="flex min-w-0 flex-1 flex-col">
        <b className="truncate text-sm">{p.player_name}</b>
        <span className="truncate text-xs text-[#9aa3b2]">{status}</span>
      </div>
      <b className={`shrink-0 font-mono ${muted ? "text-[13px] font-medium text-[#9aa3b2]" : ""}`}>{value}</b>
    </div>
  );
}

function ScoreboardCard({
  item,
  mine,
  accent,
  onOpenTeam,
}: {
  item: WeekMatchupContextItem;
  mine: boolean;
  accent: string;
  onOpenTeam: (teamId: number) => void;
}) {
  const homePct = item.home.win_probability;
  const homeAhead = (item.home.score ?? 0) >= (item.away.score ?? 0);
  return (
    <div className="flex flex-col gap-1.5 rounded-[14px] border bg-[#161a24] p-3" style={{ borderColor: mine ? accent : "rgba(255,255,255,0.08)" }}>
      {(mine || item.is_rivalry || item.is_game_of_the_week) && (
        <span className="font-display text-[10.5px] font-semibold tracking-[1.2px]" style={{ color: mine ? accent : "#fbbf24" }}>
          {mine ? "YOUR MATCHUP" : item.is_rivalry ? `${item.rivalry?.emoji ?? "⚔️"} RIVALRY` : "GAME OF THE WEEK"}
        </span>
      )}
      {[item.away, item.home].map((side) => {
        const leading = side === item.home ? homeAhead : !homeAhead;
        return (
          <button
            key={side.team_id}
            onClick={() => onOpenTeam(side.team_id)}
            aria-label={`${side.team_name}, ${fmt(side.score)} points. See roster`}
            className="flex min-h-11 items-center gap-2.5 rounded-lg text-left hover:bg-white/[0.03]"
          >
            <Avatar side={side} />
            <span className="flex min-w-0 flex-1 flex-col">
              <b className="truncate text-sm">{side.team_name}</b>
              <span className="truncate text-[11.5px] text-[#9aa3b2]">{[side.owner_name, side.record, leftLine(side)].filter(Boolean).join(" · ")}</span>
            </span>
            <span className="flex shrink-0 flex-col items-end">
              <b className={`font-mono text-lg ${leading ? "" : "text-[#9aa3b2]"}`}>{fmt(side.score)}</b>
              {side.projected_total !== null && <span className="text-[10.5px] text-[#9aa3b2]">proj {fmt(side.projected_total)}</span>}
            </span>
          </button>
        );
      })}
      {homePct !== null && (
        <div className="flex items-center gap-2">
          <span className="w-8 text-center font-mono text-[11px] text-[#9aa3b2]">{Math.round(100 - homePct)}%</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#2b2f3a]">
            <div className="h-full" style={{ width: `${100 - homePct}%`, background: accent }} />
          </div>
          <span className="w-8 text-center font-mono text-[11px] text-[#9aa3b2]">{Math.round(homePct)}%</span>
        </div>
      )}
    </div>
  );
}

function TeamRoster({ side, accent, onBack }: { side: MatchupContextSide; accent: string; onBack: () => void }) {
  const starters = side.roster.filter(isStarter);
  const bench = side.roster.filter((p) => !isStarter(p));
  const row = (p: RosterPlayer) => {
    const live = p.game_status === "in_progress";
    const upcoming = p.game_status === "scheduled" || p.game_status === null;
    return (
      <div key={`${p.player_id}-${p.lineup_slot}`} className="flex items-center gap-2.5 rounded-xl bg-[#161a24] px-3 py-2.5">
        <span className="w-9 shrink-0 text-[11px] font-bold text-[#9aa3b2]">{SLOT_LABELS[p.lineup_slot ?? ""] ?? p.lineup_slot}</span>
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: live ? (p.is_redzone ? "#f87171" : accent) : "#4b5263" }} />
        <div className="flex min-w-0 flex-1 flex-col">
          <b className="truncate text-sm">{p.player_name}</b>
          <span className="truncate text-xs text-[#9aa3b2]">{upcoming ? upcomingLine(p) : statusLine(p)}</span>
        </div>
        <b className={`shrink-0 font-mono ${upcoming ? "text-[13px] font-medium text-[#9aa3b2]" : ""}`}>
          {upcoming ? (p.on_bye ? "—" : `proj ${fmt(p.points_projected)}`) : fmt(p.points_scored)}
        </b>
      </div>
    );
  };
  return (
    <>
      <button onClick={onBack} className="self-start text-sm font-bold" style={{ color: accent }}>
        ‹ Back
      </button>
      <div className="flex items-center gap-3 rounded-[14px] bg-[#161a24] p-3">
        <Avatar side={side} size={44} />
        <div className="flex min-w-0 flex-1 flex-col">
          <b className="truncate text-base">{side.team_name}</b>
          <span className="truncate text-[11.5px] text-[#9aa3b2]">{[side.owner_name, side.record, leftLine(side)].filter(Boolean).join(" · ")}</span>
        </div>
        <div className="flex shrink-0 flex-col items-end">
          <b className="font-mono text-2xl">{fmt(side.score)}</b>
          {side.projected_total !== null && <span className="text-[11px] text-[#9aa3b2]">proj {fmt(side.projected_total)}</span>}
        </div>
      </div>
      <SectionLabel>STARTERS</SectionLabel>
      {starters.map(row)}
      {bench.length > 0 && <SectionLabel>BENCH</SectionLabel>}
      {bench.map(row)}
    </>
  );
}
