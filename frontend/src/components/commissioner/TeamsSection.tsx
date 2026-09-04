"use client";

import { useEffect, useState } from "react";
import {
  createTeamForMember,
  getLeagueMembers,
  getLeagueTeams,
  getMyLeagues,
  reassignTeam,
  type League,
  type Member,
  type Team,
} from "@/lib/leaguesApi";

/** Split out of the old single-page CommissionerApp.tsx (2026-09-03). */
export function TeamsSection() {
  const [league, setLeague] = useState<League | null>(null);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [reassignTeamId, setReassignTeamId] = useState<number | null>(null);
  const [reassignTargetUserId, setReassignTargetUserId] = useState<number | "">("");
  const [reassignBusy, setReassignBusy] = useState(false);

  const [showAddTeam, setShowAddTeam] = useState(false);
  const [addTeamUserId, setAddTeamUserId] = useState<number | "">("");
  const [addTeamName, setAddTeamName] = useState("");
  const [addTeamBusy, setAddTeamBusy] = useState(false);

  async function refresh() {
    try {
      const { leagues, activeLeagueId } = await getMyLeagues();
      const active = leagues.find((l) => l.id === activeLeagueId) ?? null;
      setLeague(active);
      if (!active) return;

      const [memberList, teamList] = await Promise.all([getLeagueMembers(active.id), getLeagueTeams(active.id)]);
      setMembers(memberList);
      setTeams(teamList);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load your league.");
    }
  }

  useEffect(() => {
    const id = setTimeout(refresh, 0);
    return () => clearTimeout(id);
  }, []);

  async function submitReassign() {
    if (!league || reassignTeamId === null || reassignTargetUserId === "") return;
    setReassignBusy(true);
    try {
      await reassignTeam(league.id, reassignTeamId, reassignTargetUserId);
      setReassignTeamId(null);
      setReassignTargetUserId("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't reassign that team.");
    } finally {
      setReassignBusy(false);
    }
  }

  async function submitAddTeam() {
    if (!league || addTeamUserId === "" || !addTeamName.trim()) return;
    setAddTeamBusy(true);
    try {
      await createTeamForMember(league.id, addTeamUserId, addTeamName.trim());
      setShowAddTeam(false);
      setAddTeamUserId("");
      setAddTeamName("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create that team.");
    } finally {
      setAddTeamBusy(false);
    }
  }

  if (league === null) {
    return error ? <p className="text-sm text-red-500">{error}</p> : null;
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p role="alert" className="text-sm text-red-500">
          {error}
        </p>
      )}
      <div className="flex flex-col gap-2">
        <button
          onClick={() => setShowAddTeam((v) => !v)}
          className="w-fit rounded-full border border-black/10 px-3 py-1.5 text-xs hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10"
        >
          {showAddTeam ? "Cancel" : "+ Add team for a member"}
        </button>
        {showAddTeam && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-black/10 p-3 dark:border-white/10">
            <select
              value={addTeamUserId}
              onChange={(e) => setAddTeamUserId(e.target.value ? Number(e.target.value) : "")}
              className="rounded-lg border border-black/10 bg-transparent px-2 py-1 text-sm dark:border-white/10"
            >
              <option value="">Pick a member…</option>
              {(members ?? []).map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.display_name}
                </option>
              ))}
            </select>
            <input
              value={addTeamName}
              onChange={(e) => setAddTeamName(e.target.value)}
              placeholder="Team name"
              className="min-w-0 flex-1 rounded-lg border border-black/10 bg-transparent px-2 py-1 text-sm dark:border-white/10"
            />
            <button
              onClick={submitAddTeam}
              disabled={addTeamBusy || addTeamUserId === "" || !addTeamName.trim()}
              className="rounded-full bg-[var(--wl-accent-dim)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
            >
              {addTeamBusy ? "Creating…" : "Create team"}
            </button>
          </div>
        )}
      </div>

      {teams === null || teams.length === 0 ? (
        <p className="text-sm text-black/50 dark:text-white/50">No teams yet.</p>
      ) : (
        <ul className="neon-panel flex flex-col divide-y divide-black/5 rounded-lg bg-black/[0.015] dark:divide-white/5 dark:bg-white/[0.03]">
          {teams.map((t) => (
            <li key={t.team_id} className="flex flex-col gap-2 px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {t.team_name} <span className="text-black/50 dark:text-white/50">— {t.owner_name}</span>
                </span>
                <button
                  onClick={() => setReassignTeamId(reassignTeamId === t.team_id ? null : t.team_id)}
                  className="rounded-full border border-black/10 px-3 py-1 text-xs hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10"
                >
                  Reassign
                </button>
              </div>

              {reassignTeamId === t.team_id && (
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={reassignTargetUserId}
                    onChange={(e) => setReassignTargetUserId(e.target.value ? Number(e.target.value) : "")}
                    className="rounded-lg border border-black/10 bg-transparent px-2 py-1 text-sm dark:border-white/10"
                  >
                    <option value="">Pick a member…</option>
                    {(members ?? []).map((m) => (
                      <option key={m.user_id} value={m.user_id}>
                        {m.display_name}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={submitReassign}
                    disabled={reassignBusy || reassignTargetUserId === ""}
                    className="rounded-full bg-[var(--wl-accent-dim)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                  >
                    {reassignBusy ? "Reassigning…" : "Confirm"}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
