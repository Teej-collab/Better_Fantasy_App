"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { addFreeAgent, dropPlayer, getMyTeam, listMyWaiverClaims, submitWaiverClaim, type RosterEntry } from "@/lib/api";
import { getPlayerCard, type PlayerCard } from "@/lib/playerCardApi";
import { nflTeamColor, nflTeamName, teamLogoUrl } from "@/lib/nfl-teams";
import { hasInjuryBadge, injuryShortCode } from "@/lib/injuryStatus";
import { GameLogTable } from "@/components/players/GameLogTable";

const TABS = ["Overview", "Game Log"] as const;
type Tab = (typeof TABS)[number];

// Picking up a free agent from the card (2026-10, so the Living Home's
// free-agent rows can go straight to a claim): pick who to drop (or no
// one, if there's room), confirm, then one add. A player still on
// waivers comes back on_waivers, and that same pick is filed as a claim,
// the same two calls the free agents page makes (FreeAgentsList.tsx).
// In a league that bids on waivers (FAAB), the confirm step takes a bid.
type Faab = { remaining: number; budget: number } | null;
type Pickup =
  | { step: "loading" }
  | { step: "pick"; roster: RosterEntry[]; rosterFull: boolean; faab: Faab }
  | { step: "confirm"; drop: RosterEntry | null; faab: Faab }
  | { step: "busy" }
  | { step: "done"; message: string }
  | { step: "error"; message: string };

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
  const [pickup, setPickup] = useState<Pickup | null>(null);
  const [bid, setBid] = useState("1");

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTab("Overview"); // this modal is one shared instance — reset the tab when a different player opens into it
    setPickup(null);
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

  function startPickup() {
    setPickup({ step: "loading" });
    Promise.all([getMyTeam(), listMyWaiverClaims().catch(() => null)])
      .then(([team, claims]) =>
        setPickup({ step: "pick", roster: team.roster, rosterFull: Boolean(team.roster_full), faab: claims?.faab ?? null })
      )
      .catch((e) => setPickup({ step: "error", message: e instanceof Error ? e.message : "Couldn't load your roster" }));
  }

  async function submitPickup(drop: RosterEntry | null, faab: Faab) {
    if (!card) return;
    const bidAmount = faab ? Math.max(0, Math.floor(Number(bid) || 0)) : undefined;
    setPickup({ step: "busy" });
    const dropId = drop?.player_id;
    try {
      const result = await addFreeAgent(card.sleeper_player_id, dropId);
      if (result.status === "ok") {
        setPickup({
          step: "done",
          message: drop ? `Added ${card.full_name}, dropped ${drop.player_name}.` : `Added ${card.full_name} to your bench.`,
        });
      } else if (result.status === "on_waivers") {
        await submitWaiverClaim(card.sleeper_player_id, dropId, bidAmount);
        setPickup({
          step: "done",
          message: `Claim filed on ${card.full_name}${bidAmount !== undefined ? ` with a $${bidAmount} bid` : ""}. It runs with the next waiver clear.`,
        });
      } else {
        setPickup({ step: "error", message: "Your roster is full. Pick someone to drop." });
      }
    } catch (e) {
      setPickup({ step: "error", message: e instanceof Error ? e.message : "Pickup failed" });
    }
  }

  const accent = card ? nflTeamColor(card.pro_team) : null;
  const isDefense = card?.position === "DEF";
  // A D/ST's picture already is its team logo — no second badge.
  const logo = card && !isDefense ? teamLogoUrl(card.pro_team) : null;
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
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 px-4 py-6" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="neon-panel flex max-h-[90vh] w-full max-w-2xl flex-col gap-4 overflow-y-auto rounded-2xl p-5"
        style={accent ? ({ "--user-accent": accent } as React.CSSProperties) : undefined}
      >
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
                    className={`h-full w-full rounded-full bg-black/5 dark:bg-white/10 ${isDefense ? "object-contain p-2" : "object-cover object-top"}`}
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
                <h1 className="text-2xl font-bold wrap-break-word">
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
                  <p className="min-w-0 wrap-break-word text-xs text-black/50 dark:text-white/50">{card.rostered_team_name}</p>
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
                {/* Someone else's player: straight to a trade for them (2026-10). */}
                <Link
                  href={
                    card.is_on_my_team || card.rostered_team_id === null
                      ? "/trades"
                      : `/trades?team=${card.rostered_team_id}&player=${encodeURIComponent(card.sleeper_player_id)}`
                  }
                  className="rounded-full bg-black/10 px-3 py-1.5 text-xs font-semibold hover:bg-black/15 dark:bg-white/10 dark:hover:bg-white/15"
                >
                  {card.is_on_my_team ? "Trade Offers" : "⇄ Trade"}
                </Link>
              </div>
            )}
            {dropError && <p className="text-xs text-red-500">{dropError}</p>}

            {card.rostered_team_id === null && !card.is_on_my_team && (
              <div className="flex flex-col gap-2 text-sm">
                {pickup === null && (
                  <button
                    onClick={startPickup}
                    className="self-start rounded-full bg-[var(--user-accent,#4cc3ff)] px-3 py-1.5 text-xs font-semibold text-white"
                  >
                    + Add / Claim
                  </button>
                )}
                {(pickup?.step === "loading" || pickup?.step === "busy") && (
                  <p className="text-black/50 dark:text-white/50">{pickup.step === "busy" ? "Working…" : "Loading your roster…"}</p>
                )}
                {pickup?.step === "pick" && (
                  <>
                    <p className="text-black/70 dark:text-white/70">
                      {pickup.rosterFull
                        ? `Your roster is full. Pick who to drop for ${card.full_name}.`
                        : `Drop someone for ${card.full_name}, or keep everyone.`}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {!pickup.rosterFull && (
                        <button
                          onClick={() => setPickup({ step: "confirm", drop: null, faab: pickup.faab })}
                          className="rounded-full border border-black/10 px-3 py-1.5 text-xs font-semibold hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10"
                        >
                          No drop
                        </button>
                      )}
                      {pickup.roster.map((entry) => (
                        <button
                          key={entry.player_id}
                          onClick={() => setPickup({ step: "confirm", drop: entry, faab: pickup.faab })}
                          className="rounded-full border border-black/10 px-3 py-1.5 text-xs hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10"
                        >
                          {entry.player_name}
                          <span className="ml-1 text-black/50 dark:text-white/50">({entry.lineup_slot})</span>
                        </button>
                      ))}
                    </div>
                    <button onClick={() => setPickup(null)} className="self-start text-xs text-black/50 hover:underline dark:text-white/50">
                      Cancel
                    </button>
                  </>
                )}
                {pickup?.step === "confirm" && (
                  <>
                    <p className="text-black/70 dark:text-white/70">
                      Pick up <strong>{card.full_name}</strong>
                      {pickup.drop ? (
                        <>
                          {" "}and drop <strong>{pickup.drop.player_name}</strong>
                        </>
                      ) : null}
                      ? If they&apos;re on waivers, this files a claim instead.
                    </p>
                    {pickup.faab && (
                      <label className="flex items-center gap-2 text-xs text-black/60 dark:text-white/60">
                        FAAB bid $
                        <input
                          type="number"
                          min={0}
                          max={pickup.faab.remaining}
                          value={bid}
                          onChange={(e) => setBid(e.target.value)}
                          className="w-20 rounded-lg border border-black/10 bg-transparent px-2 py-1 text-sm tabular-nums dark:border-white/10"
                        />
                        <span>
                          ${pickup.faab.remaining} of ${pickup.faab.budget} left · highest bid wins
                        </span>
                      </label>
                    )}
                    <div className="flex gap-2">
                      <button
                        onClick={() => submitPickup(pickup.drop, pickup.faab)}
                        className="rounded-full bg-[var(--user-accent,#4cc3ff)] px-3 py-1.5 text-xs font-semibold text-white"
                      >
                        Confirm
                      </button>
                      <button
                        onClick={startPickup}
                        className="rounded-full bg-black/10 px-3 py-1.5 text-xs font-semibold hover:bg-black/15 dark:bg-white/10 dark:hover:bg-white/15"
                      >
                        Back
                      </button>
                    </div>
                  </>
                )}
                {pickup?.step === "done" && (
                  <p className="text-green-600 dark:text-green-400">
                    {pickup.message}{" "}
                    <Link href="/free-agents" className="font-semibold underline">
                      Your claims →
                    </Link>
                  </p>
                )}
                {pickup?.step === "error" && (
                  <div className="flex items-center gap-2">
                    <p className="text-red-500">{pickup.message}</p>
                    <button onClick={startPickup} className="text-xs font-semibold underline">
                      Try again
                    </button>
                  </div>
                )}
              </div>
            )}

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
                {card.game_log ? (
                  <GameLogTable log={card.game_log} />
                ) : card.weekly_scores.length === 0 ? (
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
