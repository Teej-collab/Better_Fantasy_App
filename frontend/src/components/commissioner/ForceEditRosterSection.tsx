"use client";

import { useEffect, useState } from "react";
import { getLeagueTeams, getMyLeagues, type Team } from "@/lib/leaguesApi";
import {
  commissionerAddPlayer,
  commissionerDropPlayer,
  getTeamCurrentRoster,
} from "@/lib/commissionerLineupApi";
import type { RosterEntry } from "@/lib/api";

type FreeAgentResult = { sleeper_player_id: string; full_name: string; position: string; pro_team: string | null };

/**
 * Force-add/drop a player on any member's roster (2026-09-03) — a
 * general-purpose emergency tool for things like a member who's gone
 * dark mid-season, distinct from admin_lineup.py's own ESPN-live-write
 * test harness. Same current_rosters domain logic as the self-serve
 * My Team lineup tools; only who's allowed to trigger it differs.
 */
export function ForceEditRosterSection() {
  const [leagueId, setLeagueId] = useState<number | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<number | "">("");
  const [roster, setRoster] = useState<RosterEntry[] | null>(null);
  const [dropBusyId, setDropBusyId] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [results, setResults] = useState<FreeAgentResult[]>([]);
  const [addBusyId, setAddBusyId] = useState<string | null>(null);
  const [rosterFullFor, setRosterFullFor] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => {
      getMyLeagues()
        .then(({ leagues, activeLeagueId }) => {
          setLeagueId(activeLeagueId);
          const active = leagues.find((l) => l.id === activeLeagueId);
          if (active) return getLeagueTeams(active.id).then(setTeams);
        })
        .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load teams."));
    }, 0);
    return () => clearTimeout(id);
  }, []);

  async function loadRoster(teamId: number) {
    if (leagueId === null) return;
    setRoster(null);
    setRosterFullFor(null);
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
      setRoster(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't drop that player.");
    } finally {
      setDropBusyId(null);
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

  async function add(sleeperPlayerId: string) {
    if (leagueId === null || selectedTeamId === "") return;
    setAddBusyId(sleeperPlayerId);
    setRosterFullFor(null);
    try {
      const result = await commissionerAddPlayer(leagueId, selectedTeamId, sleeperPlayerId);
      if (result.status === "roster_full") {
        setRosterFullFor(sleeperPlayerId);
      } else {
        setRoster(result.roster);
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
        <h2 className="text-lg font-semibold">Force-Edit a Roster</h2>
        <p className="text-sm text-black/50 dark:text-white/50">
          Add or drop a player on any member&apos;s behalf — for when they can&apos;t manage their own team.
        </p>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <select
        value={selectedTeamId}
        onChange={(e) => {
          const id = e.target.value ? Number(e.target.value) : "";
          setSelectedTeamId(id);
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
                {roster.map((p) => (
                  <li key={p.player_id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span>
                      {p.player_name} <span className="text-xs text-black/50 dark:text-white/50">({p.lineup_slot})</span>
                    </span>
                    <button
                      onClick={() => drop(p.player_id)}
                      disabled={dropBusyId === p.player_id}
                      className="rounded-full border border-red-500/30 px-2.5 py-1 text-xs text-red-500 hover:bg-red-500/10 disabled:opacity-40"
                    >
                      {dropBusyId === p.player_id ? "Dropping…" : "Drop"}
                    </button>
                  </li>
                ))}
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
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
