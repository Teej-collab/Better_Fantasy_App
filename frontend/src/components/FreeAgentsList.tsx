"use client";

import { useEffect, useState } from "react";
import { addFreeAgent, getMyTeam, submitWaiverClaim, type MyFreeAgent, type RosterEntry } from "@/lib/api";
import { PlayerHeadshot } from "@/components/PlayerHeadshot";
import { usePlayerCard } from "@/components/players/PlayerCardProvider";
import { nflTeamName } from "@/lib/nfl-teams";
import { formatGameTime } from "@/lib/gameTime";
import { hasInjuryBadge, injuryShortCode } from "@/lib/injuryStatus";

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
  | { status: "claim-menu" }
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
export function FreeAgentsList({ players: initialPlayers }: { players: MyFreeAgent[] }) {
  const [players, setPlayers] = useState(initialPlayers);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [panel, setPanel] = useState<PanelState | null>(null);
  const { openPlayerCard } = usePlayerCard();
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
        setPanel({ status: "claim-menu" });
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
    setPanel({ status: "claim-menu" });
  }

  async function pickDropForClaim() {
    const team = await getMyTeam();
    setPanel({ status: "claim-pick-drop", roster: team.roster });
  }

  async function submitClaim(player: MyFreeAgent, dropSleeperPlayerId?: string) {
    setPanel({ status: "claim-submitting" });
    try {
      await submitWaiverClaim(player.sleeper_player_id, dropSleeperPlayerId);
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

  return (
    <div className="neon-panel flex flex-col rounded-lg bg-black/[0.015] dark:bg-white/[0.03]">
      <div className="flex items-center justify-between gap-3 border-b border-black/5 px-4 py-2 text-[11px] font-semibold tracking-wide text-black/40 uppercase dark:border-white/5 dark:text-white/40">
        <span>Players</span>
        <span className="flex shrink-0 items-center gap-4">
          <span className="w-10 text-right">Proj</span>
          <span className="w-10 text-right">Score</span>
          <span className="w-[52px]" aria-hidden />
        </span>
      </div>
      <ol className="flex flex-col divide-y divide-black/5 dark:divide-white/5">
        {players.map((p, i) => (
          <li key={p.sleeper_player_id}>
            <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <span className="flex min-w-0 items-center gap-3">
                <span className="w-5 shrink-0 text-black/50 tabular-nums dark:text-white/50">{i + 1}</span>
                <PlayerHeadshot sleeperPlayerId={p.sleeper_player_id} proTeam={p.pro_team} name={p.full_name} size={36} />
                <span className="flex min-w-0 flex-col">
                  <button
                    onClick={() => openPlayerCard(p.sleeper_player_id)}
                    className="truncate text-left font-medium hover:underline"
                  >
                    {p.full_name}
                    {hasInjuryBadge(p.injury_status) && (
                      <span
                        className="ml-1.5 text-xs font-bold text-red-500 dark:text-red-400"
                        title={p.injury_status ?? undefined}
                      >
                        {injuryShortCode(p.injury_status as string)}
                      </span>
                    )}
                  </button>
                  <span className="text-xs text-black/50 dark:text-white/50">
                    {/* players.position stores defenses as the raw "DEF" (Sleeper's own value) — shown as "D/ST" everywhere else in the app. */}
                    {p.position === "DEF" ? "D/ST" : p.position} ·{" "}
                    {nflTeamName(p.pro_team ?? undefined) ?? p.pro_team ?? "—"}
                  </span>
                  {p.next_opponent && (
                    <span className="text-xs text-black/50 dark:text-white/50">
                      {p.next_opponent}
                      {p.game_time && mounted && ` · ${formatGameTime(p.game_time)}`}
                    </span>
                  )}
                  {(p.waiver_clears_at || p.game_locked) && (
                    <span
                      className="mt-0.5 w-fit rounded-full bg-black/10 px-1.5 py-0.5 text-[10px] font-semibold text-black/60 uppercase dark:bg-white/10 dark:text-white/60"
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
              <span className="flex shrink-0 items-center gap-4 text-right text-xs tabular-nums text-black/60 dark:text-white/60">
                <span className="w-10">{formatStat(p.projected_points)}</span>
                <span className="w-10">{formatStat(p.score)}</span>
                {activeId === p.sleeper_player_id ? (
                  <button
                    onClick={close}
                    className="w-[52px] rounded-full border border-black/10 px-3 py-1.5 text-xs font-medium text-black/60 dark:border-white/10 dark:text-white/60"
                  >
                    Close
                  </button>
                ) : p.waiver_clears_at || p.game_locked ? (
                  <button
                    onClick={() => startClaim(p)}
                    className="w-[52px] rounded-full border border-[var(--wl-accent)] px-3 py-1.5 text-xs font-medium text-[var(--wl-accent)] hover:bg-[var(--wl-accent)]/10"
                  >
                    Claim
                  </button>
                ) : (
                  <button
                    onClick={() => startAdd(p)}
                    className="w-[52px] rounded-full bg-[var(--wl-accent-dim)] px-3 py-1.5 text-xs font-medium text-white hover:brightness-110"
                  >
                    Add
                  </button>
                )}
              </span>
            </div>

            {activeId === p.sleeper_player_id && panel && (
              <div className="border-t border-black/5 bg-black/[0.02] px-4 py-3 text-sm dark:border-white/5 dark:bg-white/[0.02]">
                {panel.status === "confirm" && (
                  <div className="flex flex-col gap-2">
                    <p className="text-black/70 dark:text-white/70">
                      Add <strong>{p.full_name}</strong> to your bench? This is a real roster move.
                    </p>
                    <button
                      onClick={() => submitAdd(p)}
                      className="w-fit rounded-full bg-[var(--wl-accent)] px-3 py-1.5 text-xs font-semibold text-black"
                    >
                      Confirm add
                    </button>
                  </div>
                )}

                {panel.status === "submitting" && <p className="text-black/50 dark:text-white/50">Adding…</p>}

                {panel.status === "success" && (
                  <p className="text-emerald-600 dark:text-emerald-400">{panel.message}</p>
                )}

                {panel.status === "error" && <p className="text-red-500">{panel.message}</p>}

                {panel.status === "needs-drop" && (
                  <div className="flex flex-col gap-2">
                    <p className="text-black/70 dark:text-white/70">
                      Your roster is full — pick a player to drop to add <strong>{p.full_name}</strong>.
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {panel.roster.map((entry) => (
                        <button
                          key={entry.player_id}
                          onClick={() => setPanel({ status: "confirm-drop", roster: panel.roster, dropCandidate: entry })}
                          className="rounded-full border border-black/10 px-3 py-1.5 text-xs hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10"
                        >
                          {entry.player_name}
                          <span className="ml-1 text-black/50 dark:text-white/50">({entry.lineup_slot})</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {panel.status === "confirm-drop" && (
                  <div className="flex flex-col gap-2">
                    <p className="text-black/70 dark:text-white/70">
                      Drop <strong>{panel.dropCandidate.player_name}</strong> to add <strong>{p.full_name}</strong>?
                      This is a real roster move.
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => submitAdd(p, panel.dropCandidate.player_id)}
                        className="w-fit rounded-full bg-[var(--wl-accent)] px-3 py-1.5 text-xs font-semibold text-black"
                      >
                        Confirm drop &amp; add
                      </button>
                      <button
                        onClick={() => setPanel({ status: "needs-drop", roster: panel.roster })}
                        className="w-fit rounded-full border border-black/10 px-3 py-1.5 text-xs font-medium text-black/60 dark:border-white/10 dark:text-white/60"
                      >
                        Back
                      </button>
                    </div>
                  </div>
                )}

                {panel.status === "claim-menu" && (
                  <div className="flex flex-col gap-2">
                    <p className="text-black/70 dark:text-white/70">
                      <strong>{p.full_name}</strong> is still on waivers
                      {mounted && p.waiver_clears_at && ` until ${formatGameTime(p.waiver_clears_at)}`}. File a claim —
                      it resolves automatically, highest this-week priority wins.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => submitClaim(p)}
                        className="w-fit rounded-full bg-[var(--wl-accent)] px-3 py-1.5 text-xs font-semibold text-black"
                      >
                        File claim
                      </button>
                      <button
                        onClick={pickDropForClaim}
                        className="w-fit rounded-full border border-black/10 px-3 py-1.5 text-xs font-medium text-black/60 dark:border-white/10 dark:text-white/60"
                      >
                        File claim with a drop
                      </button>
                    </div>
                  </div>
                )}

                {panel.status === "claim-pick-drop" && (
                  <div className="flex flex-col gap-2">
                    <p className="text-black/70 dark:text-white/70">
                      Pick a player to drop if the claim on <strong>{p.full_name}</strong> wins.
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {panel.roster.map((entry) => (
                        <button
                          key={entry.player_id}
                          onClick={() =>
                            setPanel({ status: "claim-confirm-drop", roster: panel.roster, dropCandidate: entry })
                          }
                          className="rounded-full border border-black/10 px-3 py-1.5 text-xs hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10"
                        >
                          {entry.player_name}
                          <span className="ml-1 text-black/50 dark:text-white/50">({entry.lineup_slot})</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {panel.status === "claim-confirm-drop" && (
                  <div className="flex flex-col gap-2">
                    <p className="text-black/70 dark:text-white/70">
                      File a claim: if it wins, drop <strong>{panel.dropCandidate.player_name}</strong> to add{" "}
                      <strong>{p.full_name}</strong>.
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => submitClaim(p, panel.dropCandidate.player_id)}
                        className="w-fit rounded-full bg-[var(--wl-accent)] px-3 py-1.5 text-xs font-semibold text-black"
                      >
                        Confirm claim
                      </button>
                      <button
                        onClick={() => setPanel({ status: "claim-pick-drop", roster: panel.roster })}
                        className="w-fit rounded-full border border-black/10 px-3 py-1.5 text-xs font-medium text-black/60 dark:border-white/10 dark:text-white/60"
                      >
                        Back
                      </button>
                    </div>
                  </div>
                )}

                {panel.status === "claim-submitting" && (
                  <p className="text-black/50 dark:text-white/50">Filing claim…</p>
                )}

                {panel.status === "claim-success" && (
                  <p className="text-emerald-600 dark:text-emerald-400">{panel.message}</p>
                )}

                {panel.status === "claim-error" && <p className="text-red-500">{panel.message}</p>}
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
