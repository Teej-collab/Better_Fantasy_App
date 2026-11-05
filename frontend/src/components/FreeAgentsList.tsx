"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { addFreeAgent, getMyTeam, submitWaiverClaim, type MyFreeAgent, type RosterEntry } from "@/lib/api";
import { PlayerHeadshot } from "@/components/PlayerHeadshot";
import { usePlayerCard } from "@/components/players/PlayerCardProvider";
import { EliteCard, EliteLabel, ELITE, HEX_CLIP } from "@/components/elite/Elite";
import { nflTeamName, teamLogoUrl } from "@/lib/nfl-teams";
import { formatGameTime } from "@/lib/gameTime";
import { hasInjuryBadge, injuryShortCode } from "@/lib/injuryStatus";
import { formatPositionRank, rankColorVar } from "@/lib/positionRank";
import { PlayerViewTable, PlayerViewsPill, usePlayerView } from "@/components/players/PlayerViews";

// A player whose share of rosters jumped this much in a week is "hot".
const HOT_CHANGE = 5;
const HEX_BUTTON = "flex h-[30px] w-[28px] shrink-0 items-center justify-center text-base font-black text-[#07090c] hover:brightness-110";
const PRIMARY = "w-fit rounded-full bg-[#39ff14] px-3 py-1.5 text-xs font-bold text-[#07090c] hover:brightness-110";
const SECONDARY = "w-fit rounded-full border border-white/15 px-3 py-1.5 text-xs font-medium text-[#f5f4ec]/70 hover:bg-white/5";
const CHOICE = "rounded-full border border-white/15 px-3 py-1.5 text-xs text-[#f5f4ec] hover:bg-white/10";

function formatStat(value: number | null): string {
  return value !== null ? value.toFixed(1) : "—";
}

type PanelState =
  | { status: "confirm" }
  | { status: "submitting" }
  | { status: "needs-drop"; roster: RosterEntry[] }
  // Picking who to drop used to commit the drop+add immediately on
  // click — a real accidental-drop risk (2026-09, reported). Now a
  // separate confirm step, same as every other roster-changing action
  // in this app requires.
  | { status: "confirm-drop"; roster: RosterEntry[]; dropCandidate: RosterEntry }
  | { status: "success"; message: string }
  | { status: "error"; message: string }
  // A player still within this league's real 1-day waiver period
  // (waiver_clears_at) can't be added instantly — these file a claim
  // instead (backend/app/domain/waivers.py), resolved later by the
  // scheduler once their waiver period ends. Doesn't remove the player
  // from the list on success — they're still a free agent until a
  // claim actually wins.
  // rosterFull: a claim must name a drop (no-drop claims are refused).
  | { status: "claim-menu"; rosterFull?: boolean }
  | { status: "claim-pick-drop"; roster: RosterEntry[] }
  | { status: "claim-confirm-drop"; roster: RosterEntry[]; dropCandidate: RosterEntry }
  | { status: "claim-submitting" }
  | { status: "claim-success"; message: string }
  | { status: "claim-error"; message: string };

/**
 * Client component so "Add" can act against your real live roster —
 * My Team's own lineup-move/swap flow uses the identical
 * preview-then-confirm shape (see MyTeamApp.tsx) — page.tsx stays
 * server-rendered for the actual player data and position-filter
 * links, this just owns the interactive add/drop-picker state layered
 * on top of the same list.
 *
 * Real write, not a preview: backend/app/routers/me.py's
 * /team/free-agents/add commits directly to current_rosters. There's
 * no separate preview endpoint to round-trip against first (unlike
 * lineup swaps), so the "confirm" step here is client-only — a plain
 * are-you-sure before the one real network call, so a stray click on
 * Add can't silently commit a roster move.
 */
// `bidding`: claims in this league are FAAB bids (guillotine, 2026-10).
// The trade page with this player's team and them already picked.
function tradeHref(p: MyFreeAgent): string {
  return `/trades?team=${p.rostered_team_id}&player=${encodeURIComponent(p.sleeper_player_id)}`;
}

export function FreeAgentsList({ players: initialPlayers, bidding = false }: { players: MyFreeAgent[]; bidding?: boolean }) {
  const [bid, setBid] = useState("1");
  const [players, setPlayers] = useState(initialPlayers);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [panel, setPanel] = useState<PanelState | null>(null);
  const { openPlayerCard } = usePlayerCard();
  const [view, setView] = usePlayerView("wl:player-view:free-agents");
  // Gates game_time's locale-dependent formatting to after hydration —
  // same reasoning as MyTeamApp.tsx's identical flag (server render and
  // first client paint must match, or React discards and rebuilds the
  // row on hydration, a visible jump).
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // setTimeout(0), not a direct setState call in the effect body —
    // same lint-satisfying pattern MyTeamApp.tsx's identical mount
    // effect uses.
    const id = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(id);
  }, []);

  // The position tabs and (new) search box both do a soft navigation —
  // page.tsx re-fetches and passes a new `players` prop, but React
  // keeps this same component instance mounted (no remount), so
  // useState's initial value above is never re-read on its own. Local
  // state still has to exist for the optimistic "remove from list
  // after a real Add" flow below (submitAdd), it just also needs to
  // track genuinely new server data instead of staying frozen at
  // whatever the very first filter/search happened to return — the
  // position tabs visibly doing nothing was exactly this (2026-09-02).
  useEffect(() => {
    // Deliberate: re-seed local state from new server data (see above).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPlayers(initialPlayers);
  }, [initialPlayers]);

  function startAdd(player: MyFreeAgent) {
    setActiveId(player.sleeper_player_id);
    setPanel({ status: "confirm" });
  }

  async function submitAdd(player: MyFreeAgent, dropSleeperPlayerId?: string) {
    setPanel({ status: "submitting" });
    try {
      const result = await addFreeAgent(player.sleeper_player_id, dropSleeperPlayerId);
      if (result.status === "ok") {
        setPlayers((prev) => prev.filter((p) => p.sleeper_player_id !== player.sleeper_player_id));
        setPanel({
          status: "success",
          message: result.dropped_player
            ? `Added ${player.full_name}, dropped ${result.dropped_player.player_name}.`
            : `Added ${player.full_name} to your bench.`,
        });
        return;
      }
      if (result.status === "on_waivers") {
        // Their game just kicked off (or they were already on waivers)
        // — that add attempt is also what lazily started their real
        // clock server-side, so reflect it locally and drop straight
        // into the same claim flow the list already shows for a
        // waiver_clears_at player, instead of a dead-end error.
        setPlayers((prev) =>
          prev.map((p) =>
            p.sleeper_player_id === player.sleeper_player_id ? { ...p, waiver_clears_at: result.clears_at } : p
          )
        );
        openClaimMenu();
        return;
      }
      // roster_full — need a drop pick.
      const team = await getMyTeam();
      setPanel({ status: "needs-drop", roster: team.roster });
    } catch (e) {
      setPanel({ status: "error", message: e instanceof Error ? e.message : "Add failed" });
    }
  }

  function startClaim(player: MyFreeAgent) {
    setActiveId(player.sleeper_player_id);
    openClaimMenu();
  }

  // On a full roster a claim has to name a drop (the server refuses one
  // without), so the menu only offers that once it knows.
  function openClaimMenu() {
    setPanel({ status: "claim-menu" });
    getMyTeam()
      .then((team) =>
        setPanel((prev) => (prev?.status === "claim-menu" ? { ...prev, rosterFull: Boolean(team.roster_full) } : prev))
      )
      .catch(() => {});
  }

  async function pickDropForClaim() {
    const team = await getMyTeam();
    setPanel({ status: "claim-pick-drop", roster: team.roster });
  }

  async function submitClaim(player: MyFreeAgent, dropSleeperPlayerId?: string) {
    setPanel({ status: "claim-submitting" });
    try {
      await submitWaiverClaim(player.sleeper_player_id, dropSleeperPlayerId, bidding ? Math.max(0, Math.floor(Number(bid) || 0)) : undefined);
      setPanel({
        status: "claim-success",
        message: `Claim filed on ${player.full_name}. It resolves automatically once their waiver period ends.`,
      });
    } catch (e) {
      setPanel({ status: "claim-error", message: e instanceof Error ? e.message : "Claim failed" });
    }
  }

  function close() {
    setActiveId(null);
    setPanel(null);
  }

  if (players.length === 0) {
    return <p className="text-sm text-black/50 dark:text-white/50">No free agents found.</p>;
  }

  const header = (
    <div className="flex items-center justify-between gap-3">
      <EliteLabel>Available</EliteLabel>
      <PlayerViewsPill view={view} onChange={setView} />
    </div>
  );

  if (view !== "matchup") {
    return (
      <div className="flex flex-col gap-2">
        {header}
        <PlayerViewTable
          view={view}
          rows={players.map((p) => ({
            id: p.sleeper_player_id,
            position: p.position,
            cell: (
              <span className="flex items-center gap-2">
                {/* Adding happens in the Matchup Stats layout (the confirm/
                    drop panels live there) — the + jumps back and opens it. */}
                {p.rostered_team_id != null ? (
                  p.is_mine ? (
                    <span className="h-6 w-6 shrink-0" aria-hidden />
                  ) : (
                    <Link
                      href={tradeHref(p)}
                      aria-label={`Propose a trade for ${p.full_name}`}
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-400 text-xs font-bold text-black"
                    >
                      ⇄
                    </Link>
                  )
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setView("matchup");
                      if (p.waiver_clears_at || p.game_locked) startClaim(p);
                      else startAdd(p);
                    }}
                    aria-label={p.waiver_clears_at || p.game_locked ? `Claim ${p.full_name}` : `Add ${p.full_name}`}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-400 text-sm font-bold text-black"
                  >
                    +
                  </button>
                )}
                <PlayerHeadshot sleeperPlayerId={p.sleeper_player_id} proTeam={p.pro_team} name={p.full_name} size={28} />
                <span className="flex min-w-0 flex-col">
                  <button
                    type="button"
                    onClick={() => openPlayerCard(p.sleeper_player_id)}
                    className="truncate text-left text-sm font-medium hover:underline"
                  >
                    {p.full_name}
                  </button>
                  <span className="text-[11px] text-black/50 dark:text-white/50">
                    {p.position === "DEF" ? "D/ST" : p.position} · {p.pro_team ?? "—"}
                  </span>
                </span>
              </span>
            ),
          }))}
        />
      </div>
    );
  }

  // Elite (Web A "Wire Room", 2026-11-05): an always-dark table — hex add
  // button, headshot with the team's logo, OPP, PROJ, ESPN's %ROST and
  // +/- (7 days, across every league in the app), and last week.
  const GRID = "grid grid-cols-[34px_minmax(0,1fr)_52px_56px] sm:grid-cols-[34px_minmax(200px,1fr)_96px_56px_60px_70px_52px]";
  return (
    <div className="flex flex-col gap-2">
      {header}
      <EliteCard tone="green" className="overflow-hidden">
        <div className={`${GRID} items-center gap-2 border-b border-white/[0.07] px-3 py-2 text-[10px] font-extrabold tracking-[0.12em] text-[#f5f4ec]/50 uppercase sm:px-4`}>
          <span aria-hidden />
          <span>Player</span>
          <span className="hidden sm:block">Opp</span>
          <span className="text-right">Proj</span>
          <span className="hidden text-right sm:block">%Rost</span>
          <span className="text-right">+/- 7d</span>
          <span className="hidden text-right sm:block">Last</span>
        </div>
        <ol className="flex flex-col divide-y divide-white/[0.06]">
          {players.map((p) => {
            const change = p.rost_change ?? null;
            const hot = change !== null && change >= HOT_CHANGE;
            const onWaivers = Boolean(p.waiver_clears_at || p.game_locked);
            const rank = formatPositionRank(p.opponent_position_rank, p.position);
            return (
              <li key={p.sleeper_player_id}>
                <div className={`${GRID} items-center gap-2 px-3 py-2.5 text-sm sm:px-4`}>
                  {p.rostered_team_id != null ? (
                    p.is_mine ? (
                      <span className="text-[10px] text-[#f5f4ec]/50">Yours</span>
                    ) : (
                      <Link href={tradeHref(p)} aria-label={`Propose a trade for ${p.full_name}`} className={HEX_BUTTON} style={{ clipPath: HEX_CLIP, background: "#60a5fa" }}>
                        ⇄
                      </Link>
                    )
                  ) : activeId === p.sleeper_player_id ? (
                    <button type="button" onClick={close} aria-label="Close" className={HEX_BUTTON} style={{ clipPath: HEX_CLIP, background: "rgba(245,244,236,.35)" }}>
                      ×
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => (onWaivers ? startClaim(p) : startAdd(p))}
                      aria-label={onWaivers ? `Claim ${p.full_name}` : `Add ${p.full_name}`}
                      title={onWaivers ? "On waivers: file a claim" : "Add"}
                      className={HEX_BUTTON}
                      style={{ clipPath: HEX_CLIP, background: onWaivers ? "#facc15" : ELITE.green }}
                    >
                      +
                    </button>
                  )}
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span className="relative shrink-0">
                      <PlayerHeadshot sleeperPlayerId={p.sleeper_player_id} proTeam={p.pro_team} name={p.full_name} size={38} />
                      {p.position !== "DEF" && teamLogoUrl(p.pro_team) && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={teamLogoUrl(p.pro_team)!}
                          alt={p.pro_team ?? ""}
                          className="absolute -right-1.5 -bottom-1 h-[18px] w-[18px] rounded-full bg-[#07090c] p-px"
                        />
                      )}
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => openPlayerCard(p.sleeper_player_id)}
                          className="truncate text-left font-bold text-[#f5f4ec] hover:underline"
                        >
                          {p.full_name}
                        </button>
                        <span className="shrink-0 text-[11px] font-semibold text-[#f5f4ec]/50">{p.position === "DEF" ? "D/ST" : p.position}</span>
                        {hot && (
                          <span className="shrink-0 px-1.5 py-px text-[9px] font-extrabold tracking-wider text-[#07090c]" style={{ background: ELITE.orange, clipPath: "polygon(8% 0,92% 0,100% 50%,92% 100%,8% 100%,0 50%)" }}>
                            HOT
                          </span>
                        )}
                        {hasInjuryBadge(p.injury_status) && (
                          <span className="shrink-0 text-xs font-bold text-red-400" title={p.injury_status ?? undefined}>
                            {injuryShortCode(p.injury_status as string)}
                          </span>
                        )}
                      </span>
                      <span className="truncate text-[11px] text-[#f5f4ec]/50">
                        <span className="sm:hidden">{p.pro_team ?? "—"}</span>
                        <span className="hidden sm:inline">{nflTeamName(p.pro_team ?? undefined) ?? p.pro_team ?? "—"}</span>
                        {p.next_opponent && <span className="sm:hidden"> · {p.next_opponent}</span>}
                        {p.game_time && mounted && ` · ${formatGameTime(p.game_time)}`}
                      </span>
                      {p.rostered_team_id != null && (
                        <span className="text-[11px] font-medium text-sky-400">{p.is_mine ? "Your team" : `On ${p.rostered_team_name ?? "a team"}`}</span>
                      )}
                      {p.rostered_team_id == null && onWaivers && (
                        <span
                          className="mt-0.5 w-fit rounded-full bg-[#facc15]/15 px-1.5 py-px text-[10px] font-semibold text-[#facc15] uppercase"
                          title={
                            p.waiver_clears_at
                              ? "Dropped recently — this league's real 1-day waiver period applies"
                              : "Their game has already kicked off this week — needs a waiver claim"
                          }
                        >
                          On waivers{mounted && p.waiver_clears_at && ` · clears ${formatGameTime(p.waiver_clears_at)}`}
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="hidden flex-col text-xs sm:flex">
                    <span className="text-[#f5f4ec]/80">{p.on_bye ? "Bye" : (p.next_opponent ?? "—")}</span>
                    {rank && <span style={{ color: rankColorVar(p.opponent_position_rank!.rank) }}>{rank}</span>}
                  </span>
                  <span className="text-right font-extrabold text-[#f5f4ec] tabular-nums">{p.on_bye ? "Bye" : formatStat(p.projected_points)}</span>
                  <span className="hidden text-right text-xs text-[#f5f4ec]/75 tabular-nums sm:block">{p.rost_pct != null ? `${p.rost_pct}%` : "—"}</span>
                  <span
                    className="text-right text-xs font-extrabold tabular-nums"
                    style={{ color: change === null || change === 0 ? "rgba(245,244,236,.45)" : change > 0 ? ELITE.green : ELITE.orange }}
                  >
                    {change === null || change === 0 ? "—" : `${change > 0 ? "+" : "−"}${Math.abs(change)} ${change > 0 ? "▲" : "▼"}`}
                  </span>
                  <span className="hidden text-right text-xs text-[#f5f4ec]/75 tabular-nums sm:block">{formatStat(p.last_week_score)}</span>
                </div>

                {activeId === p.sleeper_player_id && panel && (
                  <div className="border-t border-white/[0.07] bg-white/[0.03] px-4 py-3 text-sm text-[#f5f4ec]">
                    {panel.status === "confirm" && (
                      <div className="flex flex-col gap-2">
                        <p className="text-[#f5f4ec]/75">
                          Add <strong>{p.full_name}</strong> to your bench? This is a real roster move.
                        </p>
                        <button onClick={() => submitAdd(p)} className={PRIMARY}>
                          Confirm add
                        </button>
                      </div>
                    )}

                    {panel.status === "submitting" && <p className="text-[#f5f4ec]/50">Adding…</p>}

                    {panel.status === "success" && <p className="text-[#9dff86]">{panel.message}</p>}

                    {panel.status === "error" && <p className="text-red-400">{panel.message}</p>}

                    {panel.status === "needs-drop" && (
                      <div className="flex flex-col gap-2">
                        <p className="text-[#f5f4ec]/75">
                          Your roster is full — pick a player to drop to add <strong>{p.full_name}</strong>.
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {panel.roster.map((entry) => (
                            <button
                              key={entry.player_id}
                              onClick={() => setPanel({ status: "confirm-drop", roster: panel.roster, dropCandidate: entry })}
                              className={CHOICE}
                            >
                              {entry.player_name}
                              <span className="ml-1 text-[#f5f4ec]/50">({entry.lineup_slot})</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {panel.status === "confirm-drop" && (
                      <div className="flex flex-col gap-2">
                        <p className="text-[#f5f4ec]/75">
                          Drop <strong>{panel.dropCandidate.player_name}</strong> to add <strong>{p.full_name}</strong>?
                          This is a real roster move.
                        </p>
                        <div className="flex gap-2">
                          <button onClick={() => submitAdd(p, panel.dropCandidate.player_id)} className={PRIMARY}>
                            Confirm drop &amp; add
                          </button>
                          <button onClick={() => setPanel({ status: "needs-drop", roster: panel.roster })} className={SECONDARY}>
                            Back
                          </button>
                        </div>
                      </div>
                    )}

                    {panel.status === "claim-menu" && (
                      <div className="flex flex-col gap-2">
                        <p className="text-[#f5f4ec]/75">
                          <strong>{p.full_name}</strong> is still on waivers
                          {mounted && p.waiver_clears_at && ` until ${formatGameTime(p.waiver_clears_at)}`}. File a claim —
                          it resolves automatically, {bidding ? "highest bid wins (waiver priority breaks a tie)" : "highest this-week priority wins"}.
                        </p>
                        {bidding && (
                          <label className="flex items-center gap-2 text-xs text-[#f5f4ec]/65">
                            FAAB bid $
                            <input
                              type="number"
                              min={0}
                              value={bid}
                              onChange={(e) => setBid(e.target.value)}
                              className="w-20 rounded-lg border border-white/10 bg-transparent px-2 py-1 text-sm tabular-nums"
                            />
                          </label>
                        )}
                        {panel.rosterFull ? (
                          <div className="flex flex-col gap-2">
                            <p className="text-xs text-amber-400">Your roster is full — pick who to drop if this claim wins.</p>
                            <button onClick={pickDropForClaim} className={PRIMARY}>
                              Pick a drop
                            </button>
                          </div>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            <button onClick={() => submitClaim(p)} className={PRIMARY}>
                              File claim
                            </button>
                            <button onClick={pickDropForClaim} className={SECONDARY}>
                              File claim with a drop
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {panel.status === "claim-pick-drop" && (
                      <div className="flex flex-col gap-2">
                        <p className="text-[#f5f4ec]/75">
                          Pick a player to drop if the claim on <strong>{p.full_name}</strong> wins.
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {panel.roster.map((entry) => (
                            <button
                              key={entry.player_id}
                              onClick={() => setPanel({ status: "claim-confirm-drop", roster: panel.roster, dropCandidate: entry })}
                              className={CHOICE}
                            >
                              {entry.player_name}
                              <span className="ml-1 text-[#f5f4ec]/50">({entry.lineup_slot})</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {panel.status === "claim-confirm-drop" && (
                      <div className="flex flex-col gap-2">
                        <p className="text-[#f5f4ec]/75">
                          File a claim: if it wins, drop <strong>{panel.dropCandidate.player_name}</strong> to add{" "}
                          <strong>{p.full_name}</strong>.
                        </p>
                        <div className="flex gap-2">
                          <button onClick={() => submitClaim(p, panel.dropCandidate.player_id)} className={PRIMARY}>
                            Confirm claim
                          </button>
                          <button onClick={() => setPanel({ status: "claim-pick-drop", roster: panel.roster })} className={SECONDARY}>
                            Back
                          </button>
                        </div>
                      </div>
                    )}

                    {panel.status === "claim-submitting" && <p className="text-[#f5f4ec]/50">Filing claim…</p>}

                    {panel.status === "claim-success" && <p className="text-[#9dff86]">{panel.message}</p>}

                    {panel.status === "claim-error" && <p className="text-red-400">{panel.message}</p>}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </EliteCard>
    </div>
  );
}
