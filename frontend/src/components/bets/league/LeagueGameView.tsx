"use client";

import Link from "next/link";
import { AvatarStack, BetAvatar, useLive } from "@/components/bets/league/LeagueBetParts";
import { leagueGame, legPick, type BetMember, type LeagueGame, type LeagueGameEntry, type LeagueGameProp } from "@/lib/betsApi";

// Riding on this game (League Bets, web): every leg the league has on
// one NFL game. Player props put everyone's line on one bar, so you can
// see who's cashed and who still needs yards.

const muted = "text-black/50 dark:text-white/50";
const kicker = "text-[11px] font-bold tracking-wider uppercase";

function uniqueMembers(entries: LeagueGameEntry[]): BetMember[] {
  const seen = new Map<number, BetMember>();
  for (const e of entries) seen.set(e.member.user_id, e.member);
  return [...seen.values()];
}

function stat(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function headshot(sleeperId: string | null): string | null {
  return sleeperId && /^\d+$/.test(sleeperId) ? `https://sleepercdn.com/content/nfl/players/thumb/${sleeperId}.jpg` : null;
}

export function LeagueGameView({ eventId }: { eventId: string }) {
  const { data, error } = useLive(() => leagueGame(eventId), (d) => d.game?.state === "in");
  if (error && !data) return <p className="text-sm text-red-500">{error}</p>;
  if (!data) return <p className={`text-sm ${muted}`}>Loading…</p>;
  const g = data.game;
  const live = g?.state === "in";
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <Link href="/bets/league?tab=games" className={`text-sm ${muted} hover:underline`}>
        ← League Bets
      </Link>
      <section className="flex flex-col gap-4 rounded-xl border border-black/10 bg-gradient-to-br from-indigo-950/40 via-[var(--wl-surface)] to-red-950/30 p-5 dark:border-white/10">
        <p className={`${kicker} flex items-center gap-2 ${live ? "" : muted}`}>
          {live && <span className="h-2 w-2 rounded-full bg-red-500" />}
          {live ? "Live" : g?.state === "post" ? "Final" : "Upcoming"}
        </p>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
          <span className="font-display text-3xl tracking-wide uppercase">{g?.away_team ?? "—"}</span>
          <span className="font-mono text-3xl font-bold">
            {g && g.state !== "pre" ? (
              <>
                {g.away_score ?? 0}
                <span className={muted}> – </span>
                {g.home_score ?? 0}
              </>
            ) : (
              <span className={muted}>@</span>
            )}
          </span>
          <span className="text-right font-display text-3xl tracking-wide uppercase">{g?.home_team ?? "—"}</span>
        </div>
        <p className="text-sm">
          <span className="font-mono font-bold">{data.legs}</span> {data.legs === 1 ? "leg" : "legs"} ·{" "}
          <span className="font-mono font-bold">{data.member_count}</span> {data.member_count === 1 ? "member" : "members"} riding this game
        </p>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        {data.props.map((p) => (
          <PropCard key={`${p.player_name}-${p.stat_key}`} prop={p} />
        ))}
      </div>

      {data.lines.length > 0 && (
        <section className="wl-card flex flex-col gap-3 rounded-xl p-4">
          <p className={`${kicker} ${muted}`}>Game lines</p>
          {data.lines.map((l, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{legPick(l)}</p>
                <p className={`text-xs ${l.status === "won" ? "text-emerald-500" : l.status === "lost" ? "text-red-500" : muted}`}>
                  {l.status === "won" ? "Hit" : l.status === "lost" ? "Missed" : l.status === "open" ? "In play" : l.status}
                </p>
              </div>
              <AvatarStack members={uniqueMembers(l.entries).slice(0, 3)} size={24} extra={Math.max(0, uniqueMembers(l.entries).length - 3)} />
            </div>
          ))}
        </section>
      )}

      {data.rooting.length > 0 && <Rooting game={data} />}

      <Link href={`/gamecast/${encodeURIComponent(data.event_id)}`} className="self-center rounded-full bg-[var(--wl-accent)] px-6 py-2.5 text-sm font-semibold text-black">
        Open the Gamecast
      </Link>
    </div>
  );
}

function PropCard({ prop }: { prop: LeagueGameProp }) {
  const lines = prop.entries.map((e) => e.line).filter((n): n is number => n !== null);
  const current = prop.current ?? 0;
  const max = Math.max(1, current, ...lines) * 1.15;
  const pins = new Map<number, LeagueGameEntry[]>();
  for (const e of prop.entries) if (e.line !== null) pins.set(e.line, [...(pins.get(e.line) ?? []), e]);
  const toGo = lines.filter((l) => l > current);
  const cashed = prop.entries.filter((e) => e.status === "won");
  const yesNo = prop.stat_key === "anytime_td";
  const photo = headshot(prop.sleeper_player_id);
  return (
    <section className="wl-card flex flex-col gap-4 rounded-xl p-4">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-black/10 text-xs dark:bg-white/10">
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo} alt="" className="h-11 w-auto max-w-none object-cover object-top" />
          ) : (
            prop.team_abbr
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">
            {prop.player_name} · {prop.stat_label ?? "Prop"}
          </p>
          <p className={`text-xs ${muted}`}>
            {prop.team_abbr ?? ""} · {prop.entries.length} {prop.entries.length === 1 ? "bet" : "bets"} on it
          </p>
        </div>
        {prop.current !== null && <span className="font-mono text-2xl font-bold">{stat(prop.current)}</span>}
      </div>

      {!yesNo && lines.length > 0 ? (
        <div className="relative mx-1 h-16" role="img" aria-label={`${prop.player_name} at ${stat(current)}. Lines: ${[...pins.keys()].map(stat).join(", ")}.`}>
          <div className="absolute inset-x-0 top-0 h-3.5 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
            <div className="h-full bg-gradient-to-r from-sky-700 to-sky-400 transition-all duration-700" style={{ width: `${Math.min(100, (current / max) * 100)}%` }} />
          </div>
          {[...pins.entries()].map(([line, entries]) => {
            const left = Math.min(99, (line / max) * 100);
            const hit = entries.some((e) => e.status === "won") || (entries[0].direction !== "under" && current > line);
            return (
              <div key={line}>
                <span className={`absolute -top-1 h-5.5 w-[3px] rounded ${hit ? "bg-emerald-500" : "bg-black dark:bg-white"}`} style={{ left: `${left}%` }} />
                <span className="absolute top-6 flex -translate-x-1/2 flex-col items-center gap-0.5" style={{ left: `${Math.max(6, Math.min(94, left))}%` }}>
                  <AvatarStack members={uniqueMembers(entries).slice(0, 3)} size={22} />
                  <span className={`font-mono text-[10px] font-bold ${hit ? "text-emerald-500" : ""}`}>
                    {entries[0].direction === "under" ? "U " : ""}
                    {stat(line)}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {prop.entries.map((e, i) => (
            <span key={i} className="flex items-center gap-1.5 rounded-full bg-black/5 py-1 pr-3 pl-1 text-sm dark:bg-white/5">
              <BetAvatar member={e.member} size={22} />
              {e.member.name}
              {e.status === "won" ? " · hit" : e.status === "lost" ? " · missed" : ""}
            </span>
          ))}
        </div>
      )}

      {!yesNo && lines.length > 0 && (
        <div className="flex flex-wrap justify-between gap-2 text-xs">
          {cashed.length > 0 ? (
            <span className="font-semibold text-emerald-500">{cashed.map((e) => e.member.name).join(", ")} cashed</span>
          ) : (
            <span className={muted}>Nobody&apos;s cashed yet</span>
          )}
          {toGo.length > 0 && prop.current !== null && (
            <span className="text-amber-500">
              {stat(Math.min(...toGo) - current)} to go for {prop.entries.filter((e) => e.line !== null && e.line > current && e.status === "open").length} more
            </span>
          )}
        </div>
      )}
      {prop.current === null && <p className={`text-xs ${muted}`}>Updates live once the game starts.</p>}
    </section>
  );
}

function Rooting({ game }: { game: LeagueGame }) {
  const g = game.game;
  const order = g?.away_team && g.home_team ? [g.away_team, g.home_team] : game.rooting.map((r) => r.team);
  const shares = order.map((t) => ({ team: t, share: game.rooting.find((r) => r.team === t)?.share ?? 0 }));
  const colors = ["bg-blue-700", "bg-red-700"];
  return (
    <section className="wl-card flex flex-col gap-3 rounded-xl p-4">
      <p className={`${kicker} ${muted}`}>Who the league is rooting for</p>
      <div className="flex h-7 overflow-hidden rounded-lg bg-black/10 text-xs font-bold text-white dark:bg-white/10">
        {shares.map((s, i) =>
          s.share > 0 ? (
            <div key={s.team} className={`flex items-center px-2.5 ${colors[i % 2]} ${i === 0 ? "justify-start" : "justify-end"}`} style={{ flex: s.share }}>
              <span className="truncate">
                {s.team} {Math.round(s.share * 100)}%
              </span>
            </div>
          ) : null,
        )}
      </div>
      <p className={`text-xs ${muted}`}>Weighted by every leg riding on a team: spreads, moneylines and overs.</p>
    </section>
  );
}
