"use client";

import Link from "next/link";
import { useState } from "react";
import { BetAvatar, formatUnits, Icon, LeagueBetCard, memberColor, unitsClass, useLive } from "@/components/bets/league/LeagueBetParts";
import { followBettor, formatOdds, leagueMember, legPick, type LeagueMemberCard } from "@/lib/betsApi";

// A league-mate's betting card (League Bets, web): record and units,
// form, how they bet, biggest hit, you vs them, and "Ping me when they
// bet". Shared bets only; never any wager.

const muted = "text-black/50 dark:text-white/50";
const kicker = "text-[11px] font-bold tracking-wider uppercase";

const FORM_CLASS = {
  won: "bg-emerald-500",
  lost: "bg-red-950 dark:bg-[#3a1a1d]",
  push: "bg-black/15 dark:bg-white/15",
  open: "border-2 border-sky-400",
} as const;

function pct(n: number | null): string {
  return n === null ? "—" : `${Math.round(n * 100)}%`;
}

export function LeagueMemberView({ userId }: { userId: number }) {
  const { data, error, reload } = useLive(() => leagueMember(userId), (d) => d.bets.some((b) => b.status === "open"));
  if (error && !data) return <p className="text-sm text-red-500">{error}</p>;
  if (!data) return <p className={`text-sm ${muted}`}>Loading…</p>;
  return <MemberCard card={data} reload={() => void reload()} />;
}

function MemberCard({ card, reload }: { card: LeagueMemberCard; reload: () => void }) {
  const m = card.member;
  const rec = card.record;
  const style = card.style;
  const first = m.name.split(" ")[0];
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <Link href="/bets/league?tab=board" className={`text-sm ${muted} hover:underline`}>
        ← The Board
      </Link>

      <header className="flex flex-col items-center gap-2 text-center">
        <span className="rounded-full" style={{ boxShadow: `0 0 40px ${memberColor(m)}73` }}>
          <BetAvatar member={m} size={84} ring={card.rank === 1 ? "#facc15" : undefined} />
        </span>
        <h1 className="mt-1 font-display text-3xl tracking-wide uppercase">{m.name}</h1>
        <p className={`text-sm ${muted}`}>{[m.team_name, card.rank ? `#${card.rank} of ${card.of} on The Board` : null].filter(Boolean).join(" · ")}</p>
      </header>

      <div className="grid grid-cols-3 gap-2">
        <Stat value={`${rec.wins}–${rec.losses}`} label="Record" />
        <Stat value={formatUnits(rec.units)} label="Units" className={unitsClass(rec.units)} />
        <Stat value={rec.streak ?? "—"} label="Streak" className={rec.streak?.startsWith("W") ? "text-orange-500" : rec.streak?.startsWith("L") ? "text-red-500" : ""} />
      </div>

      <div className="grid items-start gap-4 md:grid-cols-2">
        {card.form.length > 0 && (
          <section className="wl-card flex flex-col gap-3 rounded-xl p-4">
            <div className={`flex justify-between ${kicker} ${muted}`}>
              <span>Form · last {card.form.length}</span>
              <span>Oldest → newest</span>
            </div>
            <div role="img" aria-label={`Last ${card.form.length} bets: ${card.form.join(", ")}`} className="flex flex-wrap gap-1">
              {card.form.map((f, i) => (
                <span key={i} className={`h-5 w-5 rounded-md ${FORM_CLASS[f]}`} />
              ))}
            </div>
          </section>
        )}

        {(style.favorite_player || style.go_to_stat || style.parlay_rate !== null) && (
          <section className="wl-card flex flex-col gap-3 rounded-xl p-4">
            <p className={`${kicker} ${muted}`}>Betting style</p>
            <div className="grid grid-cols-2 gap-3">
              {style.favorite_player && (
                <Cell
                  label="Favorite player"
                  value={style.favorite_player.player_name}
                  sub={`${style.favorite_player.wins}–${style.favorite_player.losses} on him`}
                  good={style.favorite_player.wins > style.favorite_player.losses}
                />
              )}
              {style.go_to_stat && <Cell label="Go-to market" value={style.go_to_stat.label} sub={`${pct(style.go_to_stat.share)} of legs`} />}
              {style.parlay_rate !== null && (
                <Cell label="Parlay rate" value={pct(style.parlay_rate)} sub={style.avg_parlay_legs ? `avg ${style.avg_parlay_legs} legs` : "straight bets"} />
              )}
              {style.overs_share !== null && (
                <Cell
                  label="Overs"
                  value={pct(style.overs_share)}
                  sub={style.overs_share >= 0.9 ? "never met an under" : style.overs_share <= 0.4 ? "unders guy" : "mixes it up"}
                />
              )}
            </div>
          </section>
        )}

        {card.biggest_hit && (
          <section className="flex flex-col gap-2 rounded-xl border border-yellow-400/35 bg-gradient-to-b from-yellow-500/10 to-[var(--wl-surface)] p-4">
            <div className="flex items-baseline justify-between">
              <span className={`${kicker} text-yellow-400`}>Biggest hit</span>
              <span className="font-mono text-2xl font-bold text-yellow-400">{formatOdds(card.biggest_hit.odds_american)}</span>
            </div>
            <p className="font-semibold">
              {card.biggest_hit.legs.map((l) => `${l.player_name ? `${l.player_name.split(" ").slice(-1)[0]} ` : ""}${legPick(l)}`).join(" · ")}
            </p>
            <p className={`text-xs ${muted}`}>
              {card.biggest_hit.tails > 0 ? `Tailed by ${card.biggest_hit.tails}. ` : ""}
              {new Date(card.biggest_hit.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            </p>
          </section>
        )}

        {card.vs && <VersusYou card={card} />}
      </div>

      {!card.me && <FollowButton card={card} reload={reload} />}

      {card.bets.length > 0 && <h2 className="font-display text-lg tracking-wide uppercase">Recent bets</h2>}
      <div className="grid gap-4 md:grid-cols-2">
        {card.bets.map((b) => (
          <LeagueBetCard key={b.id} bet={b} onChange={reload} />
        ))}
      </div>
      {card.bets.length === 0 && <p className={`text-center text-sm ${muted}`}>{card.me ? "You haven't" : `${first} hasn't`} shared a bet this season.</p>}
    </div>
  );
}

function Stat({ value, label, className = "" }: { value: string; label: string; className?: string }) {
  return (
    <div className="wl-card flex flex-col items-center gap-0.5 rounded-xl p-3">
      <span className={`font-mono text-xl font-bold ${className}`}>{value}</span>
      <span className={`text-xs ${muted}`}>{label}</span>
    </div>
  );
}

function Cell({ label, value, sub, good }: { label: string; value: string; sub: string; good?: boolean }) {
  return (
    <div className="min-w-0">
      <p className={`text-xs ${muted}`}>{label}</p>
      <p className="truncate font-semibold">{value}</p>
      <p className={`text-xs ${good ? "text-emerald-500" : muted}`}>{sub}</p>
    </div>
  );
}

function VersusYou({ card }: { card: LeagueMemberCard }) {
  const vs = card.vs!;
  const floor = Math.min(0, vs.you.units, vs.them.units);
  const first = card.member.name.split(" ")[0];
  return (
    <section className="wl-card flex flex-col gap-3 rounded-xl p-4">
      <p className={`${kicker} ${muted}`}>You vs {first}</p>
      <div className="flex items-center gap-3">
        <span className={`font-mono text-sm font-bold ${unitsClass(vs.you.units)}`}>{formatUnits(vs.you.units)}</span>
        <div className="flex h-2.5 flex-1 overflow-hidden rounded-full">
          <div className="bg-[var(--wl-accent)]" style={{ flex: vs.you.units - floor + 0.5 }} />
          <div style={{ flex: vs.them.units - floor + 0.5, backgroundColor: memberColor(card.member) }} />
        </div>
        <span className={`font-mono text-sm font-bold ${unitsClass(vs.them.units)}`}>{formatUnits(vs.them.units)}</span>
      </div>
      <p className={`text-xs ${muted}`}>
        You&apos;re {vs.you.wins}–{vs.you.losses}, {first} is {vs.them.wins}–{vs.them.losses}.
        {vs.shared_players.length > 0 ? ` You've both bet on ${vs.shared_players.slice(0, 3).join(", ")}.` : ""}
      </p>
    </section>
  );
}

function FollowButton({ card, reload }: { card: LeagueMemberCard; reload: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = card.member.name.split(" ")[0];
  const on = card.following;
  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      await followBettor(card.member.user_id, !on);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong — try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col items-center gap-1.5">
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={busy}
        aria-pressed={on}
        className={`flex min-h-12 items-center gap-2 rounded-full px-6 text-sm font-bold disabled:opacity-60 ${
          on ? "border border-[var(--wl-accent)]/60 text-[var(--wl-accent-dim)] dark:text-[var(--wl-accent)]" : "bg-[var(--wl-accent)] text-black"
        }`}
      >
        <Icon kind="bell" className="h-4.5 w-4.5" />
        {on ? `Pinging you when ${first} bets` : `Ping me when ${first} bets`}
      </button>
      <p className={`text-xs ${muted}`}>{on ? "Click to stop." : "Get a push the moment they share a bet, so you can tail it."}</p>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
