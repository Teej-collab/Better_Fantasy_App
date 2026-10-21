"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Chip, Kicker, Panel } from "@/components/living/LivingParts";
import type { NflGame } from "@/lib/api";
import { formatOdds, leagueBets, legPick, type Bet, type BetLeg, type LeagueFeed } from "@/lib/betsApi";
import { formatGameTime } from "@/lib/gameTime";

// Your bets for the weekend (the website's copy of the app's
// mobile/src/components/living/WeekendBetsCard.tsx): Thursday morning
// to Monday night. Live bets with their progress, settled ones with what
// they won or lost, the rest with their kickoff. Only you see the money.

const ACCENT = "#f5b942";
const WON = "#39ff14";
const LOST = "#ff7a7a";
const LIVE = "#ff8080";
const MUTED = "#8790a0";
const MAX_ROWS = 6;

type Kind = "live" | "upcoming" | "settled";

function legGame(leg: BetLeg, games: Map<string, NflGame>): NflGame | null {
  return leg.espn_event_id ? (games.get(leg.espn_event_id) ?? null) : null;
}

function betKind(bet: Bet, games: Map<string, NflGame>): Kind {
  if (bet.status !== "open") return "settled";
  const open = bet.legs.filter((l) => l.status === "open");
  // An open bet whose games are all over is waiting on the final grade.
  return open.some((l) => (legGame(l, games)?.state ?? l.game?.state) !== "pre") ? "live" : "upcoming";
}

function nextKickoff(bet: Bet, games: Map<string, NflGame>): number {
  const times = bet.legs
    .filter((l) => l.status === "open")
    .map((l) => legGame(l, games)?.date)
    .filter((d): d is string => !!d)
    .map((d) => new Date(d).getTime());
  return times.length ? Math.min(...times) : Number.MAX_SAFE_INTEGER;
}

// What a settled bet made or cost; null when the money wasn't entered.
function result(bet: Bet): number | null {
  if (bet.status === "push" || bet.status === "void") return 0;
  if (bet.stake == null) return null;
  if (bet.status === "lost") return -bet.stake;
  return bet.payout != null ? bet.payout - bet.stake : null;
}

function money(n: number): string {
  return `$${Math.abs(n) % 1 === 0 ? Math.abs(n).toFixed(0) : Math.abs(n).toFixed(2)}`;
}

function signed(n: number): string {
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${money(n)}`;
}

function formatStat(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function title(bet: Bet): string {
  if (bet.legs.length > 1) return `${bet.legs.length}-leg parlay${bet.odds_american != null ? ` · ${formatOdds(bet.odds_american)}` : ""}`;
  const leg = bet.legs[0];
  if (!leg) return "Bet";
  return leg.player_name && leg.market === "player_prop" ? `${leg.player_name} ${legPick(leg).toLowerCase()}` : legPick(leg);
}

function scoreLine(g: NflGame): string {
  return `${g.away_team ?? ""} ${g.away_score ?? ""}, ${g.home_team ?? ""} ${g.home_score ?? ""}`.trim();
}

// This weekend's bets: anything on this week's games, plus any still
// open that can't be tied to a game.
export function weekendBets(bets: Bet[], games: NflGame[]): Bet[] {
  const ids = new Set(games.map((g) => g.id));
  return bets.filter((b) => {
    const tied = b.legs.filter((l) => l.espn_event_id);
    if (tied.length === 0) return b.status === "open";
    return tied.some((l) => ids.has(l.espn_event_id!));
  });
}

export function WeekendBetsCard({ bets, games, enabled }: { bets: Bet[]; games: NflGame[]; enabled: boolean }) {
  const byId = new Map(games.map((g) => [g.id, g]));
  const mine = weekendBets(bets, games);
  // Bet tracking off in Settings: no card at all.
  if (!enabled) return null;
  if (mine.length === 0) {
    return (
      <Panel tint={ACCENT}>
        <div className="flex flex-col gap-0.5">
          <Kicker color={ACCENT}>Your bets · this weekend</Kicker>
          <span className="text-[15px] font-bold">No bets this weekend yet</span>
          <span className="text-xs text-[#8790a0]">Upload a slip from your sportsbook and it tracks here live, through Monday night.</span>
        </div>
        <BetButtons more={0} />
      </Panel>
    );
  }

  const kinds = new Map(mine.map((b) => [b.id, betKind(b, byId)]));
  const live = mine.filter((b) => kinds.get(b.id) === "live");
  const upcoming = mine.filter((b) => kinds.get(b.id) === "upcoming").sort((a, b) => nextKickoff(a, byId) - nextKickoff(b, byId));
  const settled = mine.filter((b) => kinds.get(b.id) === "settled");
  const wins = settled.filter((b) => b.status === "won").length;
  const losses = settled.filter((b) => b.status === "lost").length;
  const open = [...live, ...upcoming];
  const riding = open.reduce((sum, b) => sum + (b.stake ?? 0), 0);
  const toWin = open.reduce((sum, b) => sum + (b.payout != null && b.stake != null ? b.payout - b.stake : 0), 0);
  const results = settled.map(result).filter((n): n is number => n !== null);
  const net = results.reduce((sum, n) => sum + n, 0);

  const parts = settled.length > 0 ? [`${wins}–${losses} so far`] : [];
  if (live.length) parts.push(`${live.length} live`);
  if (upcoming.length) parts.push(settled.length || live.length ? `${upcoming.length} to come` : `${upcoming.length} open`);
  const first = upcoming[0] ? nextKickoff(upcoming[0], byId) : null;
  const headline =
    settled.length === 0 && live.length === 0 && first !== null && first !== Number.MAX_SAFE_INTEGER
      ? `${parts.join(" · ")} · first one ${formatGameTime(new Date(first).toISOString())}`
      : parts.join(" · ");

  const rows = [...live, ...upcoming, ...settled].slice(0, MAX_ROWS);
  const more = mine.length - rows.length;

  return (
    <Panel tint={ACCENT}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <Kicker color={ACCENT}>Your bets · this weekend</Kicker>
          <span className="text-[15px] font-bold">{headline}</span>
        </div>
        {results.length > 0 ? (
          <div className="flex shrink-0 flex-col items-end">
            <span className="font-display text-[26px] leading-7 tabular-nums" style={{ color: net > 0 ? WON : net < 0 ? LOST : undefined }}>
              {signed(net)}
            </span>
            <span className="text-xs text-[#8790a0]">net so far</span>
          </div>
        ) : riding > 0 ? (
          <div className="flex shrink-0 flex-col items-end">
            <span className="font-display text-[26px] leading-7 tabular-nums">{money(riding)}</span>
            <span className="text-xs text-[#8790a0]">riding{toWin > 0 ? ` · to win ${money(toWin)}` : ""}</span>
          </div>
        ) : null}
      </div>

      {rows.map((b) => (
        <BetRow key={b.id} bet={b} kind={kinds.get(b.id)!} games={byId} />
      ))}

      <BetButtons more={more} />
    </Panel>
  );
}

function BetButtons({ more }: { more: number }) {
  const button = "flex min-h-11 flex-1 items-center justify-center rounded-full px-4 text-sm font-bold transition-opacity hover:opacity-85";
  return (
    <div className="flex flex-col gap-2 pt-1">
      <div className="flex gap-2">
        <Link href="/bets" className={`${button} text-[#0b0e14]`} style={{ backgroundColor: ACCENT }}>
          Add a bet slip
        </Link>
        <Link href="/bets" className={`${button} border border-white/15`}>
          {more > 0 ? `All bets (+${more})` : "All bets"}
        </Link>
      </div>
      <LeagueBetsPill className={button} />
    </div>
  );
}

// Everyone's bets: League Bets, with how many are live right now.
function LeagueBetsPill({ className }: { className: string }) {
  const [feed, setFeed] = useState<LeagueFeed | null>(null);
  useEffect(() => {
    leagueBets()
      .then(setFeed)
      .catch(() => {});
  }, []);
  const live = feed?.enabled ? feed.sweat.alive : 0;
  const away = feed?.enabled ? feed.sweat.one_leg_away : 0;
  const detail = away > 0 ? `${away} one leg away` : live > 0 ? `${live} live` : "See everyone’s bets";
  return (
    <Link href="/bets/league" className={`${className} gap-1.5 border`} style={{ backgroundColor: "rgba(245,185,66,0.12)", borderColor: "rgba(245,185,66,0.35)" }}>
      {live > 0 && <span className="size-[7px] rounded-full" style={{ backgroundColor: LIVE }} />}
      <span>League Bets</span>
      <span className="truncate text-[13px] font-semibold" style={{ color: ACCENT }}>
        · {detail}
      </span>
    </Link>
  );
}

function BetRow({ bet, kind, games }: { bet: Bet; kind: Kind; games: Map<string, NflGame> }) {
  const parlay = bet.legs.length > 1;
  const openLegs = bet.legs.filter((l) => l.status === "open");
  const liveLeg = openLegs.find((l) => legGame(l, games)?.state === "in") ?? openLegs[0] ?? null;
  const liveGame = liveLeg ? legGame(liveLeg, games) : null;

  let chip: { text: string; color: string };
  if (kind === "live") {
    const detail = liveGame?.state === "in" ? liveGame.status_detail : liveGame?.state === "post" ? "Settling" : null;
    chip = { text: detail ? `Live · ${detail}` : "Live", color: LIVE };
  } else if (kind === "upcoming") {
    const t = nextKickoff(bet, games);
    chip = { text: t === Number.MAX_SAFE_INTEGER ? "Open" : formatGameTime(new Date(t).toISOString()), color: MUTED };
  } else {
    const r = result(bet);
    const label = { won: "Won", lost: "Lost", push: "Push", void: "Void", cashed_out: "Cashed out", open: "Open" }[bet.status];
    chip = {
      text: r !== null && r !== 0 ? `${label} ${signed(r)}` : label,
      color: bet.status === "won" ? WON : bet.status === "lost" ? LOST : MUTED,
    };
  }

  // One straight player prop in a live game: a progress bar.
  const single = !parlay ? bet.legs[0] : null;
  const bar =
    kind === "live" && single && single.market === "player_prop" && single.tracked && single.current !== null && single.target
      ? { current: single.current, target: single.target }
      : null;
  const pct = bar ? Math.max(0, Math.min(1, bar.current / bar.target)) : 0;
  const hit = bet.legs.filter((l) => l.status === "won").length;

  let sub: string | null = null;
  if (bar && single) {
    const need = bar.target - bar.current;
    const unit = single.stat_label ? ` ${single.stat_label.toLowerCase()}` : "";
    sub = `${formatStat(bar.current)} of ${formatStat(bar.target)}${unit}${need > 0 && single.direction !== "under" ? ` · needs ${formatStat(need)}` : ""}`;
  } else if (parlay && kind !== "settled") {
    const next = liveLeg ? `${liveLeg.player_name ? `${liveLeg.player_name} ` : ""}${legPick(liveLeg).toLowerCase()}` : null;
    sub = `${hit} of ${bet.legs.length} hit${next ? ` · next: ${next}` : ""}`;
  } else if (kind === "settled") {
    const g = bet.legs.map((l) => legGame(l, games)).find((x) => x?.state === "post");
    sub = g && !parlay ? `Final · ${scoreLine(g)}` : parlay ? `${hit} of ${bet.legs.length} legs hit` : null;
  } else if (kind === "upcoming" && single?.espn_event_id) {
    const g = legGame(single, games);
    sub = g ? `${g.away_team} @ ${g.home_team}` : null;
  }
  const toWin = kind !== "settled" && bet.payout != null && bet.stake != null ? bet.payout - bet.stake : null;

  return (
    <div className="flex flex-col gap-1.5 border-t border-white/10 pt-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="line-clamp-2 min-w-0 flex-1 text-sm font-semibold">{title(bet)}</span>
        <Chip color={chip.color}>{chip.text}</Chip>
      </div>
      {bar && single && (
        <div className="h-1.5 overflow-hidden rounded-full bg-[#262d3a]">
          <div className="h-full rounded-full" style={{ width: `${pct * 100}%`, backgroundColor: single.direction === "under" ? "#ff8a3d" : ACCENT }} />
        </div>
      )}
      {parlay && kind !== "settled" && (
        <div className="flex gap-1">
          {bet.legs.map((l) => (
            <span
              key={l.id}
              className="h-1.5 flex-1 rounded-full"
              style={{ backgroundColor: l.status === "won" ? WON : l.status === "lost" ? LOST : l.status === "open" ? "rgba(245,185,66,0.35)" : MUTED }}
            />
          ))}
        </div>
      )}
      {(sub || toWin !== null) && (
        <div className="flex items-center justify-between gap-2 text-xs text-[#8790a0]">
          <span className="truncate">{sub ?? ""}</span>
          {toWin !== null && toWin > 0 && <span className="shrink-0">to win {money(toWin)}</span>}
        </div>
      )}
    </div>
  );
}
