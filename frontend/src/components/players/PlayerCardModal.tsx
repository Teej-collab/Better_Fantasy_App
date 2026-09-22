"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { dropPlayer } from "@/lib/api";
import { getPlayerCard, type PlayerCard } from "@/lib/playerCardApi";
import { nflTeamColor, nflTeamName, teamLogoUrl } from "@/lib/nfl-teams";
import { hasInjuryBadge, injuryShortCode } from "@/lib/injuryStatus";

const TABS = ["Overview", "Game Log"] as const;
type Tab = (typeof TABS)[number];

// Click a player's name anywhere it's rendered inside a
// PlayerCardModal.Provider-less caller — this modal is self-contained
// (fetches on mount, owns its own loading/error state) so any list
// (draft pool, roster, free agents) can open it with nothing more than
// a sleeper_player_id.
//
// 2026-09-22 redesign (real ask, reference: a Sleeper player-card
// recording): full-screen instead of a small centered card, with an
// Overview/Game Log tab split — dismissed by the "✕" only, same as the
// reference, not a route change (see backend/app/domain/player_card.py's
// docstring and this component's own history for why a route wasn't
// worth it: this modal is opened from inside a live Draft Room too,
// where navigating away mid-draft would be real regression).
export function PlayerCardModal({ sleeperPlayerId, onClose }: { sleeperPlayerId: string; onClose: () => void }) {
  const [card, setCard] = useState<PlayerCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [headshotFailed, setHeadshotFailed] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("Overview");

  useEffect(() => {
    let cancelled = false;
    setTab("Overview"); // this modal is one shared instance — reset the tab when a different player opens into it
    getPlayerCard(sleeperPlayerId)
      .then((c) => {
        if (!cancelled) setCard(c);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load player");
      });
    return () => {
      cancelled = true;
    };
  }, [sleeperPlayerId]);

  // 2026-09-18 addition: moved here from a per-row "Drop" button on
  // MyTeamApp's own roster list (real ask, reference: real ESPN player
  // card) — a plain window.confirm rather than a styled in-page dialog
  // since this modal is mounted once at the app root with no local
  // page state to render one into (draft pool, roster, free agents,
  // matchup screen all share this one instance). A hard reload after
  // success, not router.refresh(), is deliberate: this modal has no
  // idea which page is open behind it, and most of them (MyTeamApp
  // included) manage their own roster state via a client-side fetch on
  // mount rather than server props a soft refresh would actually
  // re-render.
  async function handleDrop() {
    if (!card) return;
    if (!confirm(`Drop ${card.full_name} back to free agency? Anyone else can pick them up.`)) return;
    setDropping(true);
    setDropError(null);
    try {
      await dropPlayer(card.sleeper_player_id);
      window.location.reload();
    } catch (e) {
      setDropError(e instanceof Error ? e.message : "Drop failed");
      setDropping(false);
    }
  }

  const accent = card ? nflTeamColor(card.pro_team) : null;
  const logo = card ? teamLogoUrl(card.pro_team) : null;
  const initials = card
    ? card.full_name
        .split(/\s+/)
        .map((p) => p[0])
        .filter(Boolean)
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "";

  // Real computed totals (not ESPN's projection) — this app's own
  // weekly_scores is the authoritative "what actually happened" number,
  // same data the Game Log tab below renders row by row.
  const seasonTotal = card ? card.weekly_scores.reduce((sum, w) => sum + w.fantasy_points, 0) : 0;
  const seasonAvg = card && card.weekly_scores.length > 0 ? seasonTotal / card.weekly_scores.length : null;

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col overflow-y-auto bg-[var(--background)]"
      style={accent ? ({ "--user-accent": accent } as React.CSSProperties) : undefined}
    >
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 p-4 sm:p-6">
        <button
          onClick={onClose}
          aria-label="Close"
          className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-black/50 hover:bg-black/5 hover:text-black/70 dark:text-white/50 dark:hover:bg-white/10 dark:hover:text-white/70"
        >
          ✕
        </button>

        {error && <p className="text-sm text-red-500">{error}</p>}

        {!card && !error && <p className="py-8 text-center text-sm text-black/50 dark:text-white/50">Loading…</p>}

        {card && (
          <>
            <div className="flex items-center gap-4">
              <span className="relative inline-flex h-24 w-24 shrink-0">
                {card.headshot_url && !headshotFailed ? (
                  <Image
                    src={card.headshot_url}
                    alt={card.full_name}
                    width={96}
                    height={96}
                    onError={() => setHeadshotFailed(true)}
                    className="h-full w-full rounded-full bg-black/5 object-cover object-top dark:bg-white/10"
                  />
                ) : (
                  <span className="flex h-full w-full items-center justify-center rounded-full bg-black/10 text-2xl font-semibold text-black/50 dark:bg-white/10 dark:text-white/50">
                    {initials || card.position}
                  </span>
                )}
                {logo && (
                  <Image
                    src={logo}
                    alt=""
                    aria-hidden
                    width={32}
                    height={32}
                    className="absolute -right-1 -bottom-1 rounded-full border-2 border-[var(--background)] bg-white object-contain p-0.5"
                  />
                )}
              </span>
              <div className="flex min-w-0 flex-col">
                <h1 className="truncate text-2xl font-bold">
                  {card.full_name}
                  {hasInjuryBadge(card.injury_status) && (
                    <span
                      className="ml-1.5 text-sm font-bold text-red-500 dark:text-red-400"
                      title={card.injury_status ?? undefined}
                    >
                      {injuryShortCode(card.injury_status as string)}
                    </span>
                  )}
                </h1>
                <p className="text-sm text-black/50 dark:text-white/50">
                  {card.position} · {nflTeamName(card.pro_team) ?? card.pro_team ?? "Free agent"}
                  {card.jersey_number && ` · #${card.jersey_number}`}
                </p>
                {card.rostered_team_name && (
                  <p className="truncate text-xs text-black/50 dark:text-white/50">{card.rostered_team_name}</p>
                )}
              </div>
            </div>

            {(card.is_on_my_team || card.rostered_team_id !== null) && (
              <div className="flex flex-wrap items-center gap-2">
                {card.is_on_my_team && (
                  <button
                    onClick={handleDrop}
                    disabled={dropping}
                    className="rounded-full bg-red-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    {dropping ? "Dropping…" : "↓ Drop"}
                  </button>
                )}
                <Link
                  href="/trades"
                  className="rounded-full bg-black/10 px-3 py-1.5 text-xs font-semibold hover:bg-black/15 dark:bg-white/10 dark:hover:bg-white/15"
                >
                  Trade Offers
                </Link>
              </div>
            )}
            {dropError && <p className="text-xs text-red-500">{dropError}</p>}

            <div className="grid grid-cols-5 gap-1 rounded-xl bg-black/5 p-3 text-center dark:bg-white/5">
              <StatTile label="Pos Rank" value={card.overview?.position_rank != null ? `#${card.overview.position_rank}` : "—"} />
              <StatTile label="Avg FPTS" value={seasonAvg != null ? seasonAvg.toFixed(1) : "—"} />
              <StatTile label="Season FPTS" value={card.weekly_scores.length > 0 ? seasonTotal.toFixed(1) : "—"} />
              <StatTile label="Rost %" value={card.projection ? `${card.projection.percent_owned.toFixed(1)}%` : "—"} />
              <StatTile label="Bye" value={card.projection?.bye_week ?? "—"} />
            </div>

            <div className="flex gap-1 rounded-full bg-black/[0.04] p-1 dark:bg-white/[0.06]">
              {TABS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={
                    "flex-1 rounded-full px-3 py-1.5 text-sm font-medium transition-colors " +
                    (tab === t
                      ? "bg-white text-black shadow-sm dark:bg-white/15 dark:text-white"
                      : "text-black/50 hover:text-black dark:text-white/50 dark:hover:text-white")
                  }
                >
                  {t}
                </button>
              ))}
            </div>

            {tab === "Overview" && (
              <>
                {(card.age || card.height || card.weight || card.years_exp !== null) && (
                  <div className="grid grid-cols-4 gap-2 rounded-xl bg-black/5 p-3 text-center dark:bg-white/5">
                    <BioStat label="Age" value={card.age ?? "—"} />
                    <BioStat label="Height" value={formatHeight(card.height)} />
                    <BioStat label="Weight" value={card.weight ? `${card.weight} lbs` : "—"} />
                    <BioStat label="Exp" value={card.years_exp ?? "—"} />
                  </div>
                )}

                <div className="flex flex-col gap-2 rounded-xl bg-black/5 p-3 text-sm dark:bg-white/5">
                  <Row
                    label={card.projection ? `Week ${card.projection.current_week} opponent` : "Next opponent"}
                    value={card.projection?.next_opponent ? `@ ${card.projection.next_opponent}` : "—"}
                  />
                  <Row
                    label="Projected points (season)"
                    value={card.projection ? card.projection.season_projected_points.toFixed(1) : "—"}
                  />
                  {card.overview?.draft_rank != null && (
                    <Row
                      label="Draft rank"
                      value={
                        card.overview.position_rank != null
                          ? `#${card.overview.draft_rank} overall (#${card.overview.position_rank} ${card.position})`
                          : `#${card.overview.draft_rank} overall`
                      }
                    />
                  )}
                </div>
                {!card.projection && (
                  <p className="text-center text-[0.7rem] text-black/50 dark:text-white/50">
                    Live ESPN projections aren&apos;t available for this player right now.
                  </p>
                )}

                {card.overview?.season_outlook && (
                  <div className="flex flex-col gap-1 rounded-xl bg-black/5 p-3 text-sm dark:bg-white/5">
                    <h3 className="text-[0.65rem] font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
                      Season Outlook
                    </h3>
                    <p className="text-black/80 dark:text-white/80">{card.overview.season_outlook}</p>
                  </div>
                )}

                {card.overview?.latest_note && (
                  <div className="flex flex-col gap-1 rounded-xl bg-black/5 p-3 text-sm dark:bg-white/5">
                    <h3 className="text-[0.65rem] font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
                      Latest Note
                    </h3>
                    <p className="font-medium">{card.overview.latest_note.headline}</p>
                    {card.overview.latest_note.story && (
                      <p className="text-xs text-black/60 dark:text-white/60">{card.overview.latest_note.story}</p>
                    )}
                  </div>
                )}

                {card.overview && card.overview.news.length > 0 && (
                  <div className="flex flex-col gap-2 rounded-xl bg-black/5 p-3 text-sm dark:bg-white/5">
                    <h3 className="text-[0.65rem] font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
                      Recent News
                    </h3>
                    <ul className="flex flex-col gap-2">
                      {card.overview.news.map((item, i) => (
                        <li key={i}>
                          {item.link ? (
                            <a
                              href={item.link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-medium hover:underline"
                            >
                              {item.headline}
                            </a>
                          ) : (
                            <span className="font-medium">{item.headline}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}

            {tab === "Game Log" && (
              <div className="flex flex-col gap-1 rounded-xl bg-black/5 p-3 text-sm dark:bg-white/5">
                {card.weekly_scores.length === 0 ? (
                  <p className="py-6 text-center text-black/50 dark:text-white/50">
                    No games computed yet this season.
                  </p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[0.65rem] font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
                        <th className="pb-2">Week</th>
                        <th className="pb-2">Opp</th>
                        <th className="pb-2 text-right">Pts</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black/5 dark:divide-white/5">
                      {card.weekly_scores.map((w) => (
                        <tr key={w.week}>
                          <td className="py-2 font-medium">Wk {w.week}</td>
                          <td className="py-2 text-black/60 dark:text-white/60">{w.opponent ?? "—"}</td>
                          <td className="py-2 text-right font-semibold">{w.fantasy_points.toFixed(1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-sm font-semibold">{value}</span>
      <span className="text-[0.55rem] leading-tight uppercase tracking-wide text-black/50 dark:text-white/50">
        {label}
      </span>
    </div>
  );
}

function BioStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col">
      <span className="text-[0.65rem] uppercase tracking-wide text-black/50 dark:text-white/50">{label}</span>
      <span className="text-sm font-semibold">{value}</span>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-black/50 dark:text-white/50">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function formatHeight(height: string | null): string {
  if (!height) return "—";
  const inches = Number(height);
  if (Number.isNaN(inches)) return height;
  return `${Math.floor(inches / 12)}'${inches % 12}"`;
}
