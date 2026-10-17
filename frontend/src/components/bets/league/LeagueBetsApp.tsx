"use client";

import Link from "next/link";
import { useState } from "react";
import {
  AvatarStack,
  BetAvatar,
  formatUnits,
  Icon,
  LeagueBetCard,
  memberHref,
  unitsClass,
  useLive,
} from "@/components/bets/league/LeagueBetParts";
import {
  formatOdds,
  leagueBets,
  leagueBoard,
  leagueGames,
  type LeagueBet,
  type LeagueBoard,
  type LeagueBoardRow,
  type LeagueConsensus,
  type LeagueGameSummary,
  type LeagueSweat,
} from "@/lib/betsApi";

// League Bets (web; the app's is mobile/src/app/bets/league): every bet
// shared in the league and who placed it. Feed, The Board (records and
// units — every bet one unit at its odds, so no wager ever shows) and
// By Game. Tracking only; nothing here places a bet.

export type LeagueTab = "feed" | "board" | "games";
type Filter = "all" | "live" | "hit" | "busted" | "parlays";

const TABS: { key: LeagueTab; label: string }[] = [
  { key: "feed", label: "Feed" },
  { key: "board", label: "The Board" },
  { key: "games", label: "By Game" },
];

const muted = "text-black/50 dark:text-white/50";
const kicker = "text-[11px] font-bold tracking-wider uppercase";

export function LeagueBetsApp({ initialTab }: { initialTab: LeagueTab }) {
  const [tab, setTab] = useState<LeagueTab>(initialTab);

  function choose(t: LeagueTab) {
    setTab(t);
    const url = new URL(window.location.href);
    if (t === "feed") url.searchParams.delete("tab");
    else url.searchParams.set("tab", t);
    window.history.replaceState(null, "", url);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className={`${kicker} text-[var(--wl-accent-dim)] dark:text-[var(--wl-accent)]`}>Every bet in the league</p>
          <h1 className="font-display text-3xl tracking-wide uppercase">{tab === "board" ? "Sharps & Squares" : "League Bets"}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/bets" className="rounded-full px-4 py-2 text-sm font-semibold hover:bg-black/5 dark:hover:bg-white/10">
            My Bets
          </Link>
          <Link href="/bets" className="flex items-center gap-1 rounded-full bg-[var(--wl-accent)] px-4 py-2 text-sm font-semibold text-black">
            <Icon kind="plus" /> Add a bet
          </Link>
        </div>
      </div>

      <div role="tablist" aria-label="League Bets views" className="wl-card grid grid-cols-3 rounded-full p-1 sm:max-w-md">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => choose(t.key)}
            className={`rounded-full py-2 text-sm font-semibold transition-colors ${
              tab === t.key ? "bg-black/10 dark:bg-white/10" : `${muted} hover:text-current`
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "feed" && <Feed />}
      {tab === "board" && <Board />}
      {tab === "games" && <Games />}

      <p className={`text-center text-xs ${muted}`}>
        Wagers and payouts are never shown here. The Weekend only tracks bets — it never places them. 21+. If gambling stops being fun,
        call or text 1-800-GAMBLER.
      </p>
    </div>
  );
}

// ---- Feed ----

function Feed() {
  const { data, error, reload } = useLive(leagueBets, (d) => d.enabled && d.sweat.alive > 0);
  const [filter, setFilter] = useState<Filter>("all");
  if (error && !data) return <p className="text-sm text-red-500">{error}</p>;
  if (!data) return <p className={`text-sm ${muted}`}>Loading…</p>;
  if (!data.enabled) {
    return (
      <p className={`text-sm ${muted}`}>
        Bet tracking is off. <Link href="/settings?section=bets" className="underline">Turn it on in Settings</Link> to see League Bets.
      </p>
    );
  }
  const bets = data.bets;
  const matches: Record<Filter, (b: LeagueBet) => boolean> = {
    all: () => true,
    live: (b) => b.status === "open",
    hit: (b) => b.status === "won",
    busted: (b) => b.status === "lost",
    parlays: (b) => b.legs.length > 1,
  };
  const shown = bets.filter(matches[filter]);
  const count = (f: Filter) => bets.filter(matches[f]).length;
  const chips: { key: Filter; label: string }[] = [
    { key: "all", label: `All ${bets.length}` },
    { key: "live", label: `Live ${count("live")}` },
    { key: "hit", label: `Hit ${count("hit")}` },
    { key: "busted", label: `Busted ${count("busted")}` },
    { key: "parlays", label: "Parlays" },
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-4 lg:col-start-1 lg:row-start-1">
        {bets.length > 0 && <Chips value={filter} onChange={setFilter} options={chips} />}
        {bets.length === 0 && (
          <div className="wl-card flex flex-col items-center gap-2 rounded-xl px-6 py-12 text-center">
            <p className="font-semibold">No bets shared yet</p>
            <p className={`max-w-sm text-sm ${muted}`}>
              New bets share with the league when you save them. Add one and it shows up here for everyone, picks only.
            </p>
            <Link href="/bets" className="mt-2 rounded-full border border-black/15 px-5 py-2 text-sm font-semibold dark:border-white/15">
              Add a bet
            </Link>
          </div>
        )}
        {bets.length > 0 && shown.length === 0 && <p className={`text-center text-sm ${muted}`}>Nothing here yet.</p>}
        {shown.map((b) => (
          <LeagueBetCard key={b.id} bet={b} onChange={() => void reload()} />
        ))}
      </div>
      {(data.sweat.alive > 0 || data.consensus) && (
        // On a phone the live summary leads; on a wide screen it sits beside the feed.
        <aside className="order-first flex flex-col gap-4 lg:sticky lg:top-24 lg:col-start-2 lg:row-start-1 lg:self-start">
          {data.sweat.alive > 0 && <Sweat sweat={data.sweat} />}
          {data.consensus && <Consensus consensus={data.consensus} />}
        </aside>
      )}
    </div>
  );
}

function Sweat({ sweat }: { sweat: LeagueSweat }) {
  const c = sweat.closest;
  const leg = c?.leg;
  const g = leg?.game;
  const headline = c
    ? c.needs_more !== null && leg?.player_name
      ? `${c.member.name} needs ${c.needs_more} more ${leg.player_name.split(" ").slice(-1)[0]} ${(leg.stat_label ?? "").toLowerCase()}`
      : `${c.member.name} is one leg from hitting`
    : null;
  return (
    <section aria-label="The Sweat" className="flex flex-col gap-4 rounded-xl border border-emerald-900/50 bg-gradient-to-b from-emerald-950/40 to-[var(--wl-surface)] p-4">
      <p className={`${kicker} flex items-center gap-2`}>
        <span className="h-2 w-2 rounded-full bg-red-500 shadow-[0_0_0_4px_rgba(239,68,68,0.2)]" />
        The Sweat · this week
      </p>
      <div className="grid grid-cols-3 gap-2">
        <Stat value={String(sweat.alive)} label={sweat.alive === 1 ? "bet still alive" : "bets still alive"} />
        <Stat value={String(sweat.one_leg_away)} label="one leg away" className="text-amber-500" />
        <Stat value={formatUnits(sweat.riding_units)} label="riding on it" className="text-[var(--wl-accent-dim)] dark:text-[var(--wl-accent)]" />
      </div>
      {c && headline && (
        <Link href={memberHref(c.member.user_id)} className="flex items-center gap-3 rounded-lg bg-black/5 p-3 hover:bg-black/10 dark:bg-black/30 dark:hover:bg-black/40">
          <BetAvatar member={c.member} size={30} ring="#f59e0b" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">{headline}</span>
            <span className={`block truncate text-xs ${muted}`}>
              {c.odds_american !== null ? `to hit a ${formatOdds(c.odds_american)} ${c.legs > 1 ? "parlay" : "bet"}` : ""}
              {g?.away_team ? ` · ${g.away_team} @ ${g.home_team}` : ""}
            </span>
          </span>
          <Icon kind="chevron" className={`h-4 w-4 ${muted}`} />
        </Link>
      )}
    </section>
  );
}

function Stat({ value, label, className = "" }: { value: string; label: string; className?: string }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className={`truncate font-mono text-2xl font-bold ${className}`}>{value}</span>
      <span className={`text-xs ${muted}`}>{label}</span>
    </div>
  );
}

function Consensus({ consensus }: { consensus: LeagueConsensus }) {
  const picks = consensus.top_picks
    .map((p) => {
      const dir = p.direction === "under" ? "Under" : p.direction === "no" ? "No" : p.direction === "yes" ? "" : "Over";
      const line = p.line !== null && p.direction !== "yes" ? ` ${p.line}` : "";
      return `${p.count} on ${`${dir}${line} ${p.stat_label ?? ""}`.trim().toLowerCase()}`;
    })
    .join(" · ");
  return (
    <section aria-label="League consensus" className="wl-card flex items-center gap-3 rounded-xl p-4">
      <div className="min-w-0 flex-1">
        <p className={`${kicker} ${muted}`}>League consensus</p>
        <p className="mt-0.5 font-semibold">
          {consensus.count} of {consensus.of} are on {consensus.player_name}
        </p>
        {picks && <p className={`text-xs ${muted}`}>{picks}</p>}
      </div>
      <AvatarStack members={consensus.members.slice(0, 3)} extra={Math.max(0, consensus.count - 3)} />
    </section>
  );
}

function Chips<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { key: T; label: string }[] }) {
  return (
    <div role="group" className="flex gap-2 overflow-x-auto pb-1">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          aria-pressed={o.key === value}
          onClick={() => onChange(o.key)}
          className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
            o.key === value
              ? "border-[var(--wl-accent)] bg-[var(--wl-accent)] font-bold text-black"
              : "border-black/10 hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---- The Board ----

type Range = "season" | "week" | "parlays";

function Board() {
  const [range, setRange] = useState<Range>("season");
  return (
    <div className="flex flex-col gap-5">
      <Chips
        value={range}
        onChange={setRange}
        options={[
          { key: "season", label: "Season" },
          { key: "week", label: "This week" },
          { key: "parlays", label: "Parlays only" },
        ]}
      />
      <BoardData key={range} range={range} />
    </div>
  );
}

function BoardData({ range }: { range: Range }) {
  const { data, error } = useLive(() => leagueBoard(range === "week" ? "week" : "season", range === "parlays"), () => false);
  if (error && !data) return <p className="text-sm text-red-500">{error}</p>;
  if (!data) return <p className={`text-sm ${muted}`}>Loading…</p>;
  if (data.rows.length === 0) {
    return <p className={`text-center text-sm ${muted}`}>No shared bets {range === "week" ? "this week" : "yet"}. The Board fills in as they settle.</p>;
  }
  return <BoardBody board={data} />;
}

function BoardBody({ board }: { board: LeagueBoard }) {
  const [first, second, third] = board.rows;
  const rest = board.rows.slice(3);
  const t = board.trophies;
  const tend = board.tendencies;
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="grid grid-cols-3 items-end gap-2 sm:gap-3">
          {second ? <Podium row={second} place={2} /> : <span />}
          {first && <Podium row={first} place={1} />}
          {third ? <Podium row={third} place={3} /> : <span />}
        </div>
        {rest.length > 0 && (
          <div className="wl-card overflow-hidden rounded-xl">
            <table className="w-full text-sm">
              <thead>
                <tr className={`${kicker} ${muted} border-b border-black/5 dark:border-white/5`}>
                  <th className="w-10 py-2 pl-4 text-left">#</th>
                  <th className="py-2 text-left">Member</th>
                  <th className="py-2 text-right">Rec</th>
                  <th className="py-2 pr-4 text-right">Units</th>
                </tr>
              </thead>
              <tbody>
                {rest.map((r) => (
                  <tr key={r.user_id} className={`border-b border-black/5 last:border-0 dark:border-white/5 ${r.me ? "bg-[var(--wl-accent)]/5" : ""}`}>
                    <td className={`py-2.5 pl-4 font-mono ${muted}`}>{r.rank}</td>
                    <td className="py-2.5">
                      <Link href={memberHref(r.user_id)} className="flex items-center gap-2.5 hover:underline">
                        <BetAvatar member={r} size={32} />
                        <span className="min-w-0">
                          <span className="block truncate font-semibold">
                            {r.name}
                            {r.me && <span className="text-xs font-normal text-[var(--wl-accent-dim)] dark:text-[var(--wl-accent)]"> · you</span>}
                          </span>
                          <RowTag row={r} />
                        </span>
                      </Link>
                    </td>
                    <td className="py-2.5 text-right font-mono">
                      {r.wins}–{r.losses}
                    </td>
                    <td className={`py-2.5 pr-4 text-right font-mono font-bold ${unitsClass(r.units)}`}>{formatUnits(r.units)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className={`text-center text-xs ${muted}`}>Units: every bet counts as 1 unit at its odds, so The Board ranks picks, not bankrolls.</p>
      </div>

      <aside className="flex flex-col gap-4">
        {(t.longest_shot || t.bad_beat_king || t.most_tailed || t.best_fade) && (
          <section aria-label="Trophy case" className="flex flex-col gap-2">
            <h2 className="font-display text-lg tracking-wide uppercase">Trophy case</h2>
            <div className="grid grid-cols-2 gap-2">
              {t.longest_shot && (
                <Trophy title="Longest shot hit" tone="text-yellow-400" value={formatOdds(t.longest_shot.odds_american)} sub={`${t.longest_shot.member.name} · ${t.longest_shot.legs > 1 ? `${t.longest_shot.legs}-leg` : "straight"}`} />
              )}
              {t.bad_beat_king && <Trophy title="Bad Beat King" tone="text-red-500" value={String(t.bad_beat_king.count)} sub={`${t.bad_beat_king.member.name} · lost by one leg`} />}
              {t.most_tailed && (
                <Trophy title="Most tailed" tone="text-[var(--wl-accent-dim)] dark:text-[var(--wl-accent)]" value={String(t.most_tailed.count)} sub={`${t.most_tailed.member.name} · tails earned`} />
              )}
              {t.best_fade && <Trophy title="Best fade" tone="text-sky-400" value={`${t.best_fade.wins}–${t.best_fade.losses}`} sub={`${t.best_fade.member.name} · fading`} />}
            </div>
          </section>
        )}
        {tend.overs_share !== null && (
          <section aria-label="League tendencies" className="wl-card flex flex-col gap-2 rounded-xl p-4">
            <p className={`${kicker} ${muted}`}>League tendencies</p>
            <div className="flex justify-between text-sm">
              <span>Overs</span>
              <span className="font-mono">{Math.round(tend.overs_share * 100)}%</span>
            </div>
            <div className="flex h-2 overflow-hidden rounded-full">
              <div className="bg-sky-400" style={{ flex: tend.overs_share }} />
              <div className="bg-amber-500" style={{ flex: 1 - tend.overs_share }} />
            </div>
            <p className={`text-xs ${muted}`}>
              Overs are {tend.overs.wins}–{tend.overs.losses}. Unders are {tend.unders.wins}–{tend.unders.losses}.
              {tend.unders.wins > tend.unders.losses && tend.overs.wins < tend.overs.losses ? " Just saying." : ""}
            </p>
            {tend.parlay_hit_rate !== null && (
              <>
                <div className="mt-2 flex justify-between text-sm">
                  <span>Parlays hit</span>
                  <span className="font-mono">{Math.round(tend.parlay_hit_rate * 100)}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                  <div className="h-full bg-[var(--wl-accent)]" style={{ width: `${tend.parlay_hit_rate * 100}%` }} />
                </div>
              </>
            )}
          </section>
        )}
      </aside>
    </div>
  );
}

function RowTag({ row }: { row: LeagueBoardRow }) {
  const n = row.streak ? Number(row.streak.slice(1)) : 0;
  if (row.streak?.startsWith("W") && n >= 3) return <span className="block text-xs font-semibold text-emerald-500">{row.streak} streak</span>;
  if (row.streak?.startsWith("L") && n >= 4) return <span className="block text-xs font-semibold text-red-500">{row.streak} · fade material</span>;
  if (row.bad_beats >= 2) return <span className={`block text-xs ${muted}`}>{row.bad_beats} bad beats</span>;
  if (row.hit_rate !== null) return <span className={`block text-xs ${muted}`}>{Math.round(row.hit_rate * 100)}% hit rate</span>;
  return <span className={`block text-xs ${muted}`}>{row.open} open</span>;
}

function Podium({ row, place }: { row: LeagueBoardRow; place: 1 | 2 | 3 }) {
  const ring = place === 1 ? "#facc15" : place === 2 ? "#c0c7d2" : "#b45309";
  const big = place === 1;
  return (
    <Link
      href={memberHref(row.user_id)}
      className={`flex min-w-0 flex-col items-center gap-1.5 rounded-xl border p-3 text-center transition-transform hover:-translate-y-0.5 ${
        big
          ? "border-yellow-400/45 bg-gradient-to-b from-yellow-500/15 to-[var(--wl-surface)] pt-4 shadow-[0_0_30px_rgba(250,204,21,0.12)]"
          : "wl-card border-transparent"
      }`}
    >
      {big ? <Icon kind="crown" className="h-5 w-5 text-yellow-400" /> : <span className={`font-mono text-xs ${muted}`}>{place}</span>}
      <BetAvatar member={row} size={big ? 56 : 46} ring={ring} />
      <span className={`max-w-full truncate font-semibold ${big ? "text-base" : "text-sm"}`}>{row.name}</span>
      <span className={`font-mono font-bold ${big ? "text-xl" : "text-base"} ${unitsClass(row.units)}`}>{formatUnits(row.units)}</span>
      <span className={`text-xs ${muted}`}>
        {row.wins}–{row.losses}
        {big && row.hit_rate !== null ? ` · ${Math.round(row.hit_rate * 100)}%` : ""}
      </span>
    </Link>
  );
}

function Trophy({ title, tone, value, sub }: { title: string; tone: string; value: string; sub: string }) {
  return (
    <div className="wl-card flex flex-col gap-1 rounded-xl p-3">
      <span className={`${kicker} ${tone}`}>{title}</span>
      <span className="font-mono text-xl font-bold">{value}</span>
      <span className={`text-xs ${muted}`}>{sub}</span>
    </div>
  );
}

// ---- By Game ----

function Games() {
  const { data, error } = useLive(leagueGames, (d) => d.games.some((g) => g.game?.state === "in"));
  if (error && !data) return <p className="text-sm text-red-500">{error}</p>;
  if (!data) return <p className={`text-sm ${muted}`}>Loading…</p>;
  if (data.games.length === 0) return <p className={`text-center text-sm ${muted}`}>No league bets on this week&apos;s games yet.</p>;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {data.games.map((g) => (
        <GameRow key={g.event_id} game={g} />
      ))}
    </div>
  );
}

function GameRow({ game }: { game: LeagueGameSummary }) {
  const g = game.game;
  const live = g?.state === "in";
  const final = g?.state === "post";
  const score = g && g.state !== "pre" ? `${g.away_score ?? 0}–${g.home_score ?? 0}` : null;
  return (
    <Link href={`/bets/league/game/${encodeURIComponent(game.event_id)}`} className="wl-card flex items-center gap-3 rounded-xl p-4 transition-colors hover:bg-black/5 dark:hover:bg-white/5">
      <div className="min-w-0 flex-1">
        <p className={`${kicker} flex items-center gap-2 ${live ? "" : muted}`}>
          {live && <span className="h-2 w-2 rounded-full bg-red-500" />}
          {live ? "Live" : final ? "Final" : "Upcoming"}
        </p>
        <p className="flex items-baseline gap-3">
          <span className="font-display text-xl tracking-wide uppercase">{g?.away_team ? `${g.away_team} @ ${g.home_team}` : "Game"}</span>
          {score && <span className="font-mono font-bold">{score}</span>}
        </p>
        <p className={`text-xs ${muted}`}>
          {game.legs} {game.legs === 1 ? "leg" : "legs"} · {game.member_count} {game.member_count === 1 ? "member" : "members"}
          {game.alive > 0 && !final ? ` · ${game.alive} alive` : ""}
        </p>
      </div>
      <AvatarStack members={game.members.slice(0, 3)} extra={Math.max(0, game.member_count - 3)} />
      <Icon kind="chevron" className={`h-4 w-4 ${muted}`} />
    </Link>
  );
}
