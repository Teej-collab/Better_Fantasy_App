"use client";

import { useEffect, useState } from "react";
import { getLeagueTeams, getMyLeagues, type Team } from "@/lib/leaguesApi";
import {
  commissionerAddPlayer,
  commissionerDropPlayer,
  commissionerMovePlayer,
  commissionerSwapPlayers,
  getTeamCurrentRoster,
} from "@/lib/commissionerLineupApi";
import { commishApi } from "@/lib/commishApi";
import type { RosterEntry } from "@/lib/api";
import { BENCH_SLOT_LABEL, IR_SLOT_LABEL, isEligibleForSlot, slotDisplayLabel, STARTER_SLOT_ORDER, TAXI_SLOT_LABEL } from "@/lib/rosterSlots";

type FreeAgentResult = { sleeper_player_id: string; full_name: string; position: string; pro_team: string | null };

// Every real lineup_slot value this league's roster can ever use — the
// same set MyTeamApp's own self-serve move UI offers, just without
// that UI's locked-player restriction (this tool's whole point is
// fixing an already-live lineup, e.g. the real report that led to it:
// a team with no FLEX starter set had every slot below FLEX rendering
// the wrong player in the head-to-head table).
const ALL_LINEUP_SLOTS = [...STARTER_SLOT_ORDER, BENCH_SLOT_LABEL, IR_SLOT_LABEL, TAXI_SLOT_LABEL];
const BENCHED = [BENCH_SLOT_LABEL, IR_SLOT_LABEL, TAXI_SLOT_LABEL];
const CANT_PLAY = new Set(["Out", "IR", "Suspended", "PUP", "NFI", "Doubtful"]);

// Out or on bye this week (2026-10-23, Fix a lineup).
function flag(p: RosterEntry): { label: string; color: string } | null {
  if (p.on_bye) return { label: "BYE", color: "#ca8a04" };
  if (p.injury_status && CANT_PLAY.has(p.injury_status)) return { label: p.injury_status.toUpperCase(), color: "#ef4444" };
  return null;
}

// A starter who can't play, and the best-projected healthy bench
// player who can take his slot.
function suggestion(roster: RosterEntry[]): { out: RosterEntry; in: RosterEntry } | null {
  for (const starter of roster.filter((r) => !BENCHED.includes(r.lineup_slot) && flag(r))) {
    const best = roster
      .filter((r) => r.lineup_slot === BENCH_SLOT_LABEL && !flag(r) && isEligibleForSlot(r.position, starter.lineup_slot, r.injury_status))
      .sort((a, b) => (b.points_projected ?? 0) - (a.points_projected ?? 0))[0];
    if (best) return { out: starter, in: best };
  }
  return null;
}

/**
 * Force-add/drop a player on any member's roster (2026-09-03) — a
 * general-purpose emergency tool for things like a member who's gone
 * dark mid-season, distinct from admin_lineup.py's own ESPN-live-write
 * test harness. Same current_rosters domain logic as the self-serve
 * My Team lineup tools; only who's allowed to trigger it differs.
 */
export function ForceEditRosterSection({ initialTeamId }: { initialTeamId?: number } = {}) {
  const [leagueId, setLeagueId] = useState<number | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<number | "">(initialTeamId ?? "");
  const [note, setNote] = useState("");
  const [noteState, setNoteState] = useState<"idle" | "sending" | "sent">("idle");
  const [roster, setRoster] = useState<RosterEntry[] | null>(null);
  const [dropBusyId, setDropBusyId] = useState<string | null>(null);
  const [moveBusyId, setMoveBusyId] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [results, setResults] = useState<FreeAgentResult[]>([]);
  const [addBusyId, setAddBusyId] = useState<string | null>(null);
  const [rosterFullFor, setRosterFullFor] = useState<string | null>(null);
  const [onWaiversFor, setOnWaiversFor] = useState<{ id: string; detail: string; clearsAt: string | null } | null>(
    null
  );

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => {
      getMyLeagues()
        .then(({ leagues, activeLeagueId }) => {
          setLeagueId(activeLeagueId);
          const active = leagues.find((l) => l.id === activeLeagueId);
          if (initialTeamId !== undefined && activeLeagueId !== null) {
            getTeamCurrentRoster(activeLeagueId, initialTeamId).then(setRoster).catch(() => setRoster([]));
          }
          if (active) return getLeagueTeams(active.id).then(setTeams);
        })
        .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load teams."));
    }, 0);
    return () => clearTimeout(id);
  }, [initialTeamId]);

  async function swap(a: string, b: string) {
    if (leagueId === null || selectedTeamId === "") return;
    try {
      const { roster: updated } = await commissionerSwapPlayers(leagueId, selectedTeamId, a, b);
      setRoster(merge(updated));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't make that swap.");
    }
  }

  // The move endpoints don't send projections or byes back; keep ours.
  function merge(updated: RosterEntry[]): RosterEntry[] {
    const known = new Map((roster ?? []).map((r) => [r.player_id, r]));
    return updated.map((r) => ({ ...r, points_projected: known.get(r.player_id)?.points_projected ?? null, on_bye: known.get(r.player_id)?.on_bye }));
  }

  async function sendNote() {
    if (selectedTeamId === "") return;
    setNoteState("sending");
    try {
      await commishApi.lineupNote(selectedTeamId, note.trim());
      setNote("");
      setNoteState("sent");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send your note.");
      setNoteState("idle");
    }
  }

  async function loadRoster(teamId: number) {
    if (leagueId === null) return;
    setRoster(null);
    setRosterFullFor(null);
    setOnWaiversFor(null);
    try {
      setRoster(await getTeamCurrentRoster(leagueId, teamId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load that team's roster.");
    }
  }

  async function drop(sleeperPlayerId: string) {
    if (leagueId === null || selectedTeamId === "") return;
    setDropBusyId(sleeperPlayerId);
    try {
      const { roster: updated } = await commissionerDropPlayer(leagueId, selectedTeamId, sleeperPlayerId);
      setRoster(merge(updated));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't drop that player.");
    } finally {
      setDropBusyId(null);
    }
  }

  async function move(sleeperPlayerId: string, toSlot: string) {
    if (leagueId === null || selectedTeamId === "") return;
    setMoveBusyId(sleeperPlayerId);
    try {
      const { roster: updated } = await commissionerMovePlayer(leagueId, selectedTeamId, sleeperPlayerId, toSlot);
      setRoster(merge(updated));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't move that player.");
    } finally {
      setMoveBusyId(null);
    }
  }

  async function runSearch() {
    if (leagueId === null) return;
    try {
      const qs = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : "";
      const res = await fetch(`/api/backend/me/team/free-agents${qs}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Search failed (${res.status})`);
      const { players } = (await res.json()) as { players: FreeAgentResult[] };
      setResults(players.slice(0, 15));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't search free agents.");
    }
  }

  async function add(sleeperPlayerId: string, overrideWaivers?: boolean) {
    if (leagueId === null || selectedTeamId === "") return;
    setAddBusyId(sleeperPlayerId);
    setRosterFullFor(null);
    setOnWaiversFor(null);
    try {
      const result = await commissionerAddPlayer(
        leagueId,
        selectedTeamId,
        sleeperPlayerId,
        undefined,
        overrideWaivers
      );
      if (result.status === "roster_full") {
        setRosterFullFor(sleeperPlayerId);
      } else if (result.status === "on_waivers") {
        setOnWaiversFor({ id: sleeperPlayerId, detail: result.detail, clearsAt: result.clearsAt });
      } else {
        setRoster(merge(result.roster));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add that player.");
    } finally {
      setAddBusyId(null);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div>
        <p className="text-sm text-black/50 dark:text-white/50">
          Add, drop, or move a player on any member&apos;s behalf — for when they can&apos;t manage their own team,
          or to fix an already-live lineup (moves here work even after kickoff). Each change shows in the change log.
        </p>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <select
        value={selectedTeamId}
        onChange={(e) => {
          const id = e.target.value ? Number(e.target.value) : "";
          setSelectedTeamId(id);
          setNoteState("idle");
          setResults([]);
          setSearch("");
          if (id !== "") loadRoster(id);
        }}
        className="w-fit rounded-lg border border-black/10 bg-transparent px-2 py-1.5 text-sm dark:border-white/10"
      >
        <option value="">Pick a team…</option>
        {teams.map((t) => (
          <option key={t.team_id} value={t.team_id}>
            {t.team_name} — {t.owner_name}
          </option>
        ))}
      </select>

      {selectedTeamId !== "" && roster && suggestion(roster) && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-emerald-500/40 p-3">
          <span className="flex-1 text-sm">
            <strong>
              Start {suggestion(roster)!.in.player_name} for {suggestion(roster)!.out.player_name}
            </strong>{" "}
            — {suggestion(roster)!.out.player_name} can&apos;t play this week.
          </span>
          <button
            type="button"
            onClick={() => swap(suggestion(roster)!.out.player_id, suggestion(roster)!.in.player_id)}
            className="rounded-full bg-emerald-500/15 px-3.5 py-1.5 text-sm font-bold"
          >
            Make this swap
          </button>
        </div>
      )}

      {selectedTeamId !== "" && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
              Current roster
            </h3>
            {roster === null ? (
              <p className="text-sm text-black/50 dark:text-white/50">Loading…</p>
            ) : roster.length === 0 ? (
              <p className="text-sm text-black/50 dark:text-white/50">Empty roster.</p>
            ) : (
              <ul className="neon-panel flex flex-col divide-y divide-black/5 rounded-lg bg-black/[0.015] dark:divide-white/5 dark:bg-white/[0.03]">
                {roster.map((p) => {
                  const eligibleSlots = ALL_LINEUP_SLOTS.filter(
                    (slot) => slot !== p.lineup_slot && isEligibleForSlot(p.position, slot, p.injury_status)
                  );
                  return (
                    <li key={p.player_id} className="flex flex-col gap-1.5 px-3 py-2 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span>
                          {p.player_name}{" "}
                          <span className="text-xs text-black/50 dark:text-white/50">({p.lineup_slot})</span>
                          {flag(p) && (
                            <span className="ml-1.5 text-[11px] font-extrabold" style={{ color: flag(p)!.color }}>
                              {flag(p)!.label}
                            </span>
                          )}
                          {p.points_projected != null && (
                            <span className="ml-1.5 text-xs text-black/50 tabular-nums dark:text-white/50">{p.points_projected.toFixed(1)} proj</span>
                          )}
                        </span>
                        <button
                          onClick={() => drop(p.player_id)}
                          disabled={dropBusyId === p.player_id}
                          className="shrink-0 rounded-full border border-red-500/30 px-2.5 py-1 text-xs text-red-500 hover:bg-red-500/10 disabled:opacity-40"
                        >
                          {dropBusyId === p.player_id ? "Dropping…" : "Drop"}
                        </button>
                      </div>
                      {eligibleSlots.length > 0 && (
                        <select
                          value=""
                          disabled={moveBusyId === p.player_id}
                          onChange={(e) => {
                            if (e.target.value) move(p.player_id, e.target.value);
                          }}
                          className="w-fit rounded-lg border border-black/10 bg-transparent px-2 py-1 text-xs disabled:opacity-40 dark:border-white/10"
                        >
                          <option value="">
                            {moveBusyId === p.player_id ? "Moving…" : "Move to…"}
                          </option>
                          {eligibleSlots.map((slot) => (
                            <option key={slot} value={slot}>
                              {slotDisplayLabel(slot)}
                            </option>
                          ))}
                        </select>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
              Add a free agent
            </h3>
            <div className="flex gap-2">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runSearch()}
                placeholder="Search players…"
                className="min-w-0 flex-1 rounded-lg border border-black/10 bg-transparent px-2 py-1.5 text-sm dark:border-white/10"
              />
              <button
                onClick={runSearch}
                className="shrink-0 rounded-full border border-black/10 px-3 py-1.5 text-xs hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10"
              >
                Search
              </button>
            </div>
            {results.length > 0 && (
              <ul className="neon-panel flex flex-col divide-y divide-black/5 rounded-lg bg-black/[0.015] dark:divide-white/5 dark:bg-white/[0.03]">
                {results.map((p) => (
                  <li key={p.sleeper_player_id} className="flex flex-col gap-1 px-3 py-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span>
                        {p.full_name}{" "}
                        <span className="text-xs text-black/50 dark:text-white/50">
                          {p.position}
                          {p.pro_team ? ` — ${p.pro_team}` : ""}
                        </span>
                      </span>
                      <button
                        onClick={() => add(p.sleeper_player_id)}
                        disabled={addBusyId === p.sleeper_player_id}
                        className="rounded-full border border-emerald-500/40 px-2.5 py-1 text-xs text-emerald-600 hover:bg-emerald-500/10 disabled:opacity-40 dark:text-emerald-400"
                      >
                        {addBusyId === p.sleeper_player_id ? "Adding…" : "Add"}
                      </button>
                    </div>
                    {rosterFullFor === p.sleeper_player_id && (
                      <p className="text-xs text-red-500">Roster is full — drop a player above first.</p>
                    )}
                    {onWaiversFor?.id === p.sleeper_player_id && (
                      <div className="flex flex-col gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2">
                        <p className="text-xs text-amber-600 dark:text-amber-400">
                          {onWaiversFor.clearsAt
                            ? `Still on waivers until ${new Date(onWaiversFor.clearsAt).toLocaleString()}.`
                            : onWaiversFor.detail}
                        </p>
                        <button
                          onClick={() => add(p.sleeper_player_id, true)}
                          disabled={addBusyId === p.sleeper_player_id}
                          className="w-fit rounded-full border border-amber-500/40 px-2.5 py-1 text-xs font-medium text-amber-600 hover:bg-amber-500/10 disabled:opacity-40 dark:text-amber-400"
                        >
                          {addBusyId === p.sleeper_player_id ? "Adding…" : "Force add anyway (override waivers)"}
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      {selectedTeamId !== "" && (
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">Tell them why</h3>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder="e.g. Swapped out Hall since he's ruled out."
            className="rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/10"
          />
          <button
            type="button"
            onClick={sendNote}
            disabled={!note.trim() || noteState === "sending"}
            className="self-start rounded-full bg-violet-500/15 px-4 py-1.5 text-sm font-bold disabled:opacity-50"
          >
            {noteState === "sending" ? "Sending…" : noteState === "sent" ? "Sent" : "Send note"}
          </button>
        </div>
      )}
    </section>
  );
}
