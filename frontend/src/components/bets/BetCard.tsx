"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { formatMoney, formatOdds, legPick, type Bet, type BetLeg, type BetStatus } from "@/lib/betsApi";

// One bet slip with every leg's live progress — the same card on My
// Bets, the Gamecast's Your Bets panel, and a bet shared to league chat.
// `footer` is where the owner's own actions go (share, mark result...).

const STATUS_STYLES: Record<BetStatus, { label: string; className: string }> = {
  open: { label: "Live", className: "bg-sky-500/15 text-sky-500" },
  won: { label: "Won", className: "bg-emerald-500/15 text-emerald-500" },
  lost: { label: "Lost", className: "bg-red-500/15 text-red-500" },
  push: { label: "Push", className: "bg-black/10 text-black/60 dark:bg-white/10 dark:text-white/60" },
  void: { label: "Void", className: "bg-black/10 text-black/60 dark:bg-white/10 dark:text-white/60" },
  cashed_out: { label: "Cashed out", className: "bg-amber-500/15 text-amber-500" },
};

export function BetStatusPill({ status }: { status: BetStatus }) {
  const s = STATUS_STYLES[status];
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase ${s.className}`}>{s.label}</span>
  );
}

export function BetCard({
  bet,
  shared = false,
  onlyEventId,
  footer,
}: {
  bet: Bet;
  // Shown to someone other than the bettor: names them, hides the money.
  shared?: boolean;
  // Gamecast: highlight the legs riding on this game, dim the rest.
  onlyEventId?: string;
  footer?: ReactNode;
}) {
  const parlay = bet.legs.length > 1;
  const settled = bet.legs.filter((l) => l.status !== "open").length;
  return (
    <div className="wl-card flex flex-col gap-3 rounded-xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
            {shared ? `${bet.owner_name}'s ` : ""}
            {parlay ? `${bet.legs.length}-leg parlay` : "Straight bet"}
            {bet.sportsbook ? ` · ${bet.sportsbook}` : ""}
          </p>
          {parlay && bet.status === "open" && (
            <p className="text-xs text-black/40 dark:text-white/40">
              {settled} of {bet.legs.length} legs settled
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {bet.odds_american !== null && <span className="font-mono text-sm font-semibold">{formatOdds(bet.odds_american)}</span>}
          <BetStatusPill status={bet.status} />
        </div>
      </div>

      <ul className="flex flex-col gap-2">
        {bet.legs.map((leg) => (
          <LegRow key={leg.id} leg={leg} dim={onlyEventId !== undefined && leg.espn_event_id !== onlyEventId} />
        ))}
      </ul>

      {!shared && (bet.stake !== undefined || bet.payout !== undefined) && (bet.stake !== null || bet.payout !== null) && (
        <div className="flex items-center justify-between border-t border-black/5 pt-2 text-xs text-black/60 dark:border-white/5 dark:text-white/60">
          <span>Wager {formatMoney(bet.stake)}</span>
          <span>
            {bet.status === "won" ? "Paid" : "To pay"} <strong className="font-mono">{formatMoney(bet.payout)}</strong>
          </span>
        </div>
      )}
      {footer}
    </div>
  );
}

function LegRow({ leg, dim }: { leg: BetLeg; dim: boolean }) {
  const pct =
    leg.tracked && leg.current !== null && leg.target
      ? Math.max(0, Math.min(100, (leg.current / leg.target) * 100))
      : null;
  const icon = leg.status === "won" ? "✅" : leg.status === "lost" ? "❌" : leg.status === "push" || leg.status === "void" ? "➖" : "⏳";
  const barColor =
    leg.status === "won" ? "bg-emerald-500" : leg.status === "lost" ? "bg-red-500" : leg.direction === "under" ? "bg-amber-500" : "bg-sky-500";
  return (
    <li className={`flex flex-col gap-1 ${dim ? "opacity-50" : ""}`}>
      <div className="flex items-start gap-2 text-sm">
        <span aria-hidden className="leading-5">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium wrap-break-word">
            {leg.player_name ? `${leg.player_name} — ` : ""}
            {legPick(leg)}
          </p>
          <p className="text-xs text-black/50 dark:text-white/50">
            {gameLine(leg)}
            {!leg.tracked && " · not auto-tracked"}
          </p>
        </div>
        {leg.tracked && leg.current !== null && leg.market === "player_prop" && (
          <span className="shrink-0 font-mono text-sm font-semibold tabular-nums">
            {formatStat(leg.current)}
            {leg.target !== null && <span className="text-black/40 dark:text-white/40"> / {formatStat(leg.target)}</span>}
          </span>
        )}
      </div>
      {pct !== null && leg.market === "player_prop" && leg.status === "open" && (
        <div
          className="ml-6 h-1.5 overflow-hidden rounded-full bg-black/10 dark:bg-white/10"
          role="progressbar"
          aria-valuenow={leg.current ?? 0}
          aria-valuemax={leg.target ?? undefined}
          aria-label={`${leg.player_name ?? "Leg"} progress`}
        >
          <div className={`h-full rounded-full transition-all duration-700 ${barColor}`} style={{ width: `${pct}%` }} />
        </div>
      )}
    </li>
  );
}

function gameLine(leg: BetLeg): ReactNode {
  const g = leg.game;
  if (!g || !g.home_team || !g.away_team) return leg.team_abbr ?? "Game not found this week";
  const score = g.state === "pre" ? "" : ` ${g.away_score ?? 0}–${g.home_score ?? 0}`;
  const status = g.state === "post" ? " · Final" : g.state === "in" ? " · Live" : "";
  const text = `${g.away_team} @ ${g.home_team}${score}${status}`;
  return leg.espn_event_id ? (
    <Link href={`/gamecast/${leg.espn_event_id}`} className="underline-offset-2 hover:underline">
      {text}
    </Link>
  ) : (
    text
  );
}

function formatStat(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
