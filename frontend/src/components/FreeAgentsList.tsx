"use client";

import { useState } from "react";
import {
  getMyTeam,
  previewAddFreeAgent,
  type AddFreeAgentPreview,
  type FreeAgent,
  type RosterEntry,
} from "@/lib/api";
import { PlayerHeadshot } from "@/components/PlayerHeadshot";
import { usePlayerCard } from "@/components/players/PlayerCardProvider";
import { nflTeamName } from "@/lib/nfl-teams";

type PanelState =
  | { status: "loading" }
  | { status: "preview"; preview: AddFreeAgentPreview }
  | { status: "needs-drop"; roster: RosterEntry[]; selected: string | null; submitting: boolean }
  | { status: "error"; message: string };

/**
 * Client component so "Add" can preview against your real live
 * roster (My Team's own lineup-move/swap previews use the identical
 * pattern) — page.tsx stays server-rendered for the actual player
 * data and position-filter links, this just owns the interactive
 * add/preview/drop-picker state layered on top of the same list.
 */
export function FreeAgentsList({ players }: { players: FreeAgent[] }) {
  const [activeId, setActiveId] = useState<number | null>(null);
  const [panel, setPanel] = useState<PanelState | null>(null);
  const [cachedRoster, setCachedRoster] = useState<RosterEntry[] | null>(null);
  const { openPlayerCard } = usePlayerCard();

  async function startAdd(player: FreeAgent) {
    setActiveId(player.player_id);
    setPanel({ status: "loading" });
    try {
      const result = await previewAddFreeAgent(player);
      if (result.status === "ok") {
        setPanel({ status: "preview", preview: result.preview });
        return;
      }
      // roster_full — need a drop pick. Reuse the roster fetched for a
      // previous roster-full case in this same visit instead of
      // re-fetching every time.
      let roster = cachedRoster;
      if (!roster) {
        const team = await getMyTeam();
        roster = team.roster;
        setCachedRoster(roster);
      }
      setPanel({ status: "needs-drop", roster, selected: null, submitting: false });
    } catch (e) {
      setPanel({ status: "error", message: e instanceof Error ? e.message : "Preview failed" });
    }
  }

  async function confirmDrop(player: FreeAgent, dropName: string) {
    setPanel((prev) => (prev && prev.status === "needs-drop" ? { ...prev, submitting: true } : prev));
    try {
      const result = await previewAddFreeAgent(player, dropName);
      if (result.status === "ok") {
        setPanel({ status: "preview", preview: result.preview });
      } else {
        setPanel({ status: "error", message: result.detail });
      }
    } catch (e) {
      setPanel({ status: "error", message: e instanceof Error ? e.message : "Preview failed" });
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
        <li key={p.player_id}>
          <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
            <span className="flex min-w-0 items-center gap-3">
              <span className="w-5 shrink-0 text-black/40 tabular-nums dark:text-white/40">{i + 1}</span>
              <PlayerHeadshot playerId={p.player_id} proTeam={p.pro_team} name={p.name} size={36} />
              <span className="flex min-w-0 flex-col">
                <span className="flex min-w-0 items-center gap-1.5 font-medium">
                  {p.sleeper_player_id ? (
                    <button onClick={() => openPlayerCard(p.sleeper_player_id!)} className="min-w-0 truncate hover:underline">
                      {p.name}
                    </button>
                  ) : (
                    <span className="min-w-0 truncate">{p.name}</span>
                  )}
                  {p.injury_status && p.injury_status !== "ACTIVE" && (
                    <span className="shrink-0 rounded-full bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-600 uppercase dark:text-red-400">
                      {p.injury_status}
                    </span>
                  )}
                </span>
                <span className="text-xs text-black/50 dark:text-white/50">
                  {p.position} · {nflTeamName(p.pro_team) ?? p.pro_team}
                </span>
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-3 text-right text-xs tabular-nums text-black/60 dark:text-white/60">
              <span className="flex flex-col items-end">
                <span className="font-semibold">{p.projected_points ?? "—"}</span>
                <span className="text-black/40 dark:text-white/40">projected</span>
              </span>
              <span className="hidden flex-col items-end sm:flex">
                <span className="font-semibold">{p.percent_owned}%</span>
                <span className="text-black/40 dark:text-white/40">owned</span>
              </span>
              {activeId === p.player_id ? (
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

          {activeId === p.player_id && panel && (
            <div className="border-t border-black/5 bg-black/[0.02] px-4 py-3 text-sm dark:border-white/5 dark:bg-white/[0.02]">
              {panel.status === "loading" && <p className="text-black/50 dark:text-white/50">Checking your roster…</p>}

              {panel.status === "error" && <p className="text-red-500">{panel.message}</p>}

              {panel.status === "needs-drop" && (
                <div className="flex flex-col gap-2">
                  <p className="text-black/70 dark:text-white/70">
                    Your roster is full — pick a player to drop to add <strong>{p.name}</strong>.
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {panel.roster.map((entry) => (
                      <button
                        key={entry.player_id}
                        disabled={panel.submitting}
                        onClick={() => confirmDrop(p, entry.player_name)}
                        className="rounded-full border border-black/10 px-3 py-1.5 text-xs hover:bg-black/5 disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/10"
                      >
                        {entry.player_name}
                        <span className="ml-1 text-black/40 dark:text-white/40">({entry.lineup_slot})</span>
                      </button>
                    ))}
                  </div>
                  {panel.submitting && <p className="text-xs text-black/50 dark:text-white/50">Checking…</p>}
                </div>
              )}

              {panel.status === "preview" && (
                <div className="flex flex-col gap-1">
                  <p className="text-black/70 dark:text-white/70">
                    Would add <strong>{panel.preview.added_player.player_name}</strong> to your bench
                    {panel.preview.dropped_player && (
                      <>
                        {" "}
                        and drop <strong>{panel.preview.dropped_player.player_name}</strong>
                      </>
                    )}
                    .
                  </p>
                  <p className="text-xs text-black/50 dark:text-white/50">
                    Roster {panel.preview.dropped_player ? panel.preview.roster_size_before : panel.preview.roster_size_before + 1}
                    /{panel.preview.roster_capacity} after this move.
                  </p>
                </div>
              )}
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}
