"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { BetCard } from "@/components/bets/BetCard";
import { reactToBet, tailBet, type BetMember, type BetReaction, type LeagueBet } from "@/lib/betsApi";
import { useOnAppRefresh } from "@/lib/usePullToRefresh";
import { startVisibleInterval } from "@/lib/visibleInterval";

// League Bets' shared pieces (2026-10-17, "League Bets Mockups" canvas;
// same screens as the app's mobile/src/app/bets/league): a bettor's
// avatar, units, and one league bet with who placed it and Tail / Fade /
// Sweat / RIP. The slip itself is BetCard, so legs look the same as on
// My Bets. Never any wager or payout.

const PALETTE = ["#6366f1", "#ec4899", "#0ea5e9", "#f97316", "#14b8a6", "#a855f7", "#84cc16", "#eab308", "#ef4444", "#22d3ee"];

export function memberColor(m: BetMember): string {
  return m.color && /^#[0-9a-f]{6}$/i.test(m.color) ? m.color : PALETTE[m.user_id % PALETTE.length];
}

export function BetAvatar({ member, size = 38, ring }: { member: BetMember; size?: number; ring?: string }) {
  const initials = member.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        backgroundColor: memberColor(member),
        boxShadow: ring ? `0 0 0 2px ${ring}` : undefined,
      }}
    >
      {initials}
    </span>
  );
}

export function AvatarStack({ members, size = 26, extra = 0 }: { members: BetMember[]; size?: number; extra?: number }) {
  return (
    <span aria-hidden className="flex items-center">
      {members.map((m, i) => (
        <span key={m.user_id} className="rounded-full ring-2 ring-[var(--wl-surface)]" style={{ marginLeft: i ? -size * 0.32 : 0 }}>
          <BetAvatar member={m} size={size} />
        </span>
      ))}
      {extra > 0 && (
        <span
          className="inline-flex items-center justify-center rounded-full bg-black/10 text-[10px] font-bold text-black/60 ring-2 ring-[var(--wl-surface)] dark:bg-white/10 dark:text-white/60"
          style={{ width: size, height: size, marginLeft: -size * 0.32 }}
        >
          +{extra}
        </span>
      )}
    </span>
  );
}

export function formatUnits(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined) return "—";
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(digits)}u`;
}

export function unitsClass(n: number | null | undefined): string {
  return !n ? "text-black/50 dark:text-white/50" : n > 0 ? "text-[var(--wl-accent-dim)] dark:text-[var(--wl-accent)]" : "text-red-500";
}

export function memberHref(userId: number): string {
  return `/bets/league/member/${userId}`;
}

// Loads on mount, again on pull-to-refresh, and every 30s while `live`
// says something is still in play.
export function useLive<T>(fetcher: () => Promise<T>, live: (data: T) => boolean) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fetchRef = useRef(fetcher);
  useEffect(() => {
    fetchRef.current = fetcher;
  });
  const load = useCallback(async () => {
    try {
      setData(await fetchRef.current());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load League Bets.");
    }
  }, []);
  useEffect(() => {
    const id = setTimeout(load, 0);
    return () => clearTimeout(id);
  }, [load]);
  const isLive = data !== null && live(data);
  useEffect(() => {
    if (!isLive) return;
    return startVisibleInterval(load, 30_000);
  }, [isLive, load]);
  useOnAppRefresh(load);
  return { data, error, reload: load };
}

function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function Icon({ kind, className = "h-4 w-4" }: { kind: "tail" | "fade" | "flame" | "rip" | "bell" | "chevron" | "crown" | "plus"; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
      {kind === "tail" && <path d="M7 17L17 7M9 7h8v8" />}
      {kind === "fade" && <path d="M17 7L7 17M15 17H7V9" />}
      {kind === "flame" && <path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-4 2.5-5 .3 2 1.5 3 2.5 3 0-3-1-5.5 0-8z" />}
      {kind === "rip" && <path d="M7 21V10a5 5 0 0 1 10 0v11zM10 13h4M12 11v5" />}
      {kind === "bell" && <path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10 20a2 2 0 0 0 4 0" />}
      {kind === "chevron" && <path d="M9 6l6 6-6 6" />}
      {kind === "crown" && <path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z" />}
      {kind === "plus" && <path d="M12 5v14M5 12h14" />}
    </svg>
  );
}

function BettorRow({ bet }: { bet: LeagueBet }) {
  const m = bet.member;
  return (
    <Link href={memberHref(m.user_id)} className="-m-1 flex items-center gap-3 rounded-lg p-1 hover:bg-black/5 dark:hover:bg-white/5">
      <BetAvatar member={m} ring={bet.one_leg_away ? "#f59e0b" : undefined} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">
          {m.name}
          {m.team_name && <span className="font-normal text-black/50 dark:text-white/50"> · {m.team_name}</span>}
        </span>
        <span className="block truncate text-xs text-black/50 dark:text-white/50">
          {timeAgo(bet.created_at)} · {bet.member_record} this season
        </span>
      </span>
      {bet.one_leg_away && (
        <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-extrabold tracking-wide text-amber-500 uppercase">
          1 leg away
        </span>
      )}
    </Link>
  );
}

export function LeagueBetCard({ bet, onChange }: { bet: LeagueBet; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const settled = bet.status !== "open";

  async function act(action: () => Promise<unknown>, done?: string) {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      await action();
      if (done) setNote(done);
      onChange();
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Something went wrong — try again.");
    } finally {
      setBusy(false);
    }
  }

  const react = (kind: BetReaction) => act(() => reactToBet(bet.id, kind, !bet.reactions[kind].mine));
  const beat = bet.bad_beat;
  const beatLeg = beat ? bet.legs.find((l) => l.id === beat.leg_id) : null;
  const glow = bet.one_leg_away
    ? "shadow-[0_0_0_1px_rgba(245,158,11,0.35),0_0_24px_rgba(245,158,11,0.14)]"
    : bet.status === "won"
      ? "shadow-[0_0_0_1px_rgba(34,197,94,0.35),0_0_24px_rgba(34,197,94,0.14)]"
      : "";

  const footer = (
    <div className="flex flex-col gap-2 border-t border-black/5 pt-3 dark:border-white/5">
      {beat && (
        <div className="relative overflow-hidden rounded-lg bg-red-500/10 px-3 py-2">
          <p className="font-display text-lg tracking-wide text-red-500 uppercase">Bad beat</p>
          <p className="text-xs font-semibold text-red-500">
            {beat.missed_by !== null && beatLeg
              ? `Missed ${beatLeg.player_name ?? "it"} by ${beat.missed_by}. Every other leg hit.`
              : "Lost on the last leg. Every other leg hit."}
          </p>
        </div>
      )}
      {bet.tails.count > 0 && (
        <p className="text-xs text-black/50 dark:text-white/50">
          Tailed by <strong className="font-semibold text-black/80 dark:text-white/80">{bet.tails.names.join(", ")}</strong>
          {bet.tails.count > bet.tails.names.length ? ` +${bet.tails.count - bet.tails.names.length}` : ""}
          {bet.status === "won" ? " — they hit too" : ""}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {!bet.mine && !settled && (
          <ActionButton
            label={bet.tails.mine ? "Tailed" : "Tail"}
            count={bet.tails.count}
            icon="tail"
            active={bet.tails.mine}
            primary
            disabled={busy}
            title={bet.tails.mine ? "It's in My Bets" : "Saves these picks to My Bets"}
            onClick={() => {
              if (bet.tails.mine) return;
              if (!window.confirm(`Tail ${bet.member.name}? This saves the same picks to My Bets so they track for you too.`)) return;
              void act(() => tailBet(bet.id), "Tailed. It's in My Bets.");
            }}
          />
        )}
        {!bet.mine && !settled && !bet.tails.mine && (
          <ActionButton label="Fade" count={bet.reactions.fade.count} icon="fade" active={bet.reactions.fade.mine} disabled={busy} title="You're betting against it" onClick={() => void react("fade")} />
        )}
        {!settled && (
          <ActionButton label="Sweat" count={bet.reactions.sweat.count} icon="flame" active={bet.reactions.sweat.mine} disabled={busy} title="You're watching it with them" onClick={() => void react("sweat")} />
        )}
        {bet.status === "lost" && (
          <ActionButton label="RIP" count={bet.reactions.rip.count} icon="rip" active={bet.reactions.rip.mine} disabled={busy} title="Pay your respects" onClick={() => void react("rip")} />
        )}
        {bet.status === "won" && bet.units !== null && (
          <span className={`flex items-center px-2 font-mono text-sm font-bold ${unitsClass(bet.units)}`}>{formatUnits(bet.units)}</span>
        )}
      </div>
      {note && <p className="text-xs text-black/60 dark:text-white/60">{note}</p>}
    </div>
  );

  return (
    <div className={`rounded-xl ${glow}`}>
      {/* Not `shared`: the bettor's row already names them, and a league
          bet never carries the money. */}
      <BetCard bet={bet} header={<BettorRow bet={bet} />} footer={footer} />
    </div>
  );
}

function ActionButton({
  label,
  count,
  icon,
  active,
  primary,
  disabled,
  title,
  onClick,
}: {
  label: string;
  count: number;
  icon: "tail" | "fade" | "flame" | "rip";
  active: boolean;
  primary?: boolean;
  disabled: boolean;
  title: string;
  onClick: () => void;
}) {
  const tone =
    icon === "flame" ? "text-orange-500" : icon === "rip" ? "text-red-500" : primary ? "text-[var(--wl-accent-dim)] dark:text-[var(--wl-accent)]" : "";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={active}
      className={`flex min-h-11 flex-1 basis-0 items-center justify-center gap-1.5 rounded-lg border px-2 text-sm font-semibold whitespace-nowrap transition-colors disabled:opacity-60 ${
        active
          ? "border-current/40 bg-current/10"
          : primary
            ? "border-transparent bg-[var(--wl-accent)]/10 hover:bg-[var(--wl-accent)]/20"
            : "border-transparent bg-black/5 hover:bg-black/10 dark:bg-white/5 dark:hover:bg-white/10"
      } ${tone}`}
    >
      <Icon kind={icon} />
      <span className={icon === "fade" ? "" : "text-current"}>
        {label}
        {count > 0 ? ` · ${count}` : ""}
      </span>
    </button>
  );
}
