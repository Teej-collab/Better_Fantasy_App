"use client";

import { useEffect, useState } from "react";
import { addFreeAgent, getMyTeam, type MyFreeAgent, type RosterEntry } from "@/lib/api";
import { PlayerHeadshot } from "@/components/PlayerHeadshot";
import { usePlayerCard } from "@/components/players/PlayerCardProvider";
import { nflTeamName } from "@/lib/nfl-teams";

type PanelState =
  | { status: "confirm" }
  | { status: "submitting" }
  | { status: "needs-drop"; roster: RosterEntry[] }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

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
      // roster_full — need a drop pick.
      const team = await getMyTeam();
      setPanel({ status: "needs-drop", roster: team.roster });
    } catch (e) {
      setPanel({ status: "error", message: e instanceof Error ? e.message : "Add failed" });
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
    <ol className="neon-panel flex flex-col divide-y divide-black/5 rounded-lg bg-black/[0.015] dark:divide-white/5 dark:bg-white/[0.03]">
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
                </button>
                <span className="text-xs text-black/50 dark:text-white/50">
                  {p.position} · {nflTeamName(p.pro_team ?? undefined) ?? p.pro_team ?? "—"}
                </span>
                {p.injury_status && p.injury_status !== "ACTIVE" && (
                  <span className="mt-0.5 w-fit rounded-full bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-600 uppercase dark:text-red-400">
                    {p.injury_status}
                  </span>
                )}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-3 text-right text-xs tabular-nums text-black/60 dark:text-white/60">
              {activeId === p.sleeper_player_id ? (
                <button
                  onClick={close}
                  className="rounded-full border border-black/10 px-3 py-1.5 text-xs font-medium text-black/60 dark:border-white/10 dark:text-white/60"
                >
                  Close
                </button>
              ) : (
                <button
                  onClick={() => startAdd(p)}
                  className="rounded-full bg-[var(--wl-accent-dim)] px-3 py-1.5 text-xs font-medium text-white hover:brightness-110"
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
                        onClick={() => submitAdd(p, entry.player_id)}
                        className="rounded-full border border-black/10 px-3 py-1.5 text-xs hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10"
                      >
                        {entry.player_name}
                        <span className="ml-1 text-black/50 dark:text-white/50">({entry.lineup_slot})</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}
