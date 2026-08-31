"use client";

import { useEffect, useState } from "react";
import {
  createLeague,
  createTeam,
  getLeagueTeams,
  getMyLeagues,
  joinLeague,
  type League,
  type Team,
} from "@/lib/leaguesApi";

/**
 * Self-serve create/join-a-league + create-your-team flow (Phase 5
 * follow-on of the multi-league migration — see backend TODO.md's
 * PHASE 9 entry). Deliberately not woven into the rest of the app yet
 * (standings/matchups/draft/etc. all still implicitly show League #1)
 * — that's a much bigger "which league am I looking at" frontend
 * change of its own, out of scope here. This page proves the backend
 * flow end to end: create or join a league, then create a team in it.
 */
export default function LeaguesPage() {
  const [leagues, setLeagues] = useState<League[] | null>(null);
  const [teamsByLeague, setTeamsByLeague] = useState<Record<number, Team[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [newLeagueName, setNewLeagueName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [teamNameByLeague, setTeamNameByLeague] = useState<Record<number, string>>({});

  async function refresh() {
    try {
      const mine = await getMyLeagues();
      setLeagues(mine);
      const teamLists = await Promise.all(mine.map((l) => getLeagueTeams(l.id).catch(() => [] as Team[])));
      setTeamsByLeague(Object.fromEntries(mine.map((l, i) => [l.id, teamLists[i]])));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load your leagues — try signing in again.");
      setLeagues([]);
    }
  }

  useEffect(() => {
    // setTimeout(0) rather than calling refresh() directly — still
    // counts as a callback to the lint rule below (unlike an async
    // function invoked straight in the effect body), while running
    // effectively immediately on mount.
    const id = setTimeout(refresh, 0);
    return () => clearTimeout(id);
  }, []);

  async function handleCreateLeague(e: React.FormEvent) {
    e.preventDefault();
    if (!newLeagueName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await createLeague(newLeagueName.trim());
      setNewLeagueName("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the league");
    } finally {
      setBusy(false);
    }
  }

  async function handleJoinLeague(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteCode.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await joinLeague(inviteCode.trim());
      setInviteCode("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't join that league");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateTeam(leagueId: number) {
    const teamName = (teamNameByLeague[leagueId] ?? "").trim();
    if (!teamName) return;
    setBusy(true);
    setError(null);
    try {
      await createTeam(leagueId, teamName);
      setTeamNameByLeague((prev) => ({ ...prev, [leagueId]: "" }));
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create your team");
    } finally {
      setBusy(false);
    }
  }

  if (leagues === null) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">Leagues</h1>
        <p className="text-sm text-black/60 dark:text-white/60">Loading…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Leagues</h1>
      {error && <p className="text-sm text-red-500">{error}</p>}

      <section className="neon-panel flex flex-col gap-3 rounded-xl p-4">
        <h2 className="text-sm font-semibold">Your leagues</h2>
        {leagues.length === 0 ? (
          <p className="text-sm text-black/60 dark:text-white/60">
            You&apos;re not in any leagues yet — create one or join with an invite code below.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {leagues.map((league) => {
              const teams = teamsByLeague[league.id] ?? [];
              return (
                <div key={league.id} className="flex flex-col gap-2 rounded-lg border border-black/10 p-3 dark:border-white/10">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{league.name}</span>
                    <span className="rounded-full border border-black/10 px-2 py-0.5 text-xs text-black/60 dark:border-white/10 dark:text-white/60">
                      {league.role}
                    </span>
                  </div>
                  <p className="text-xs text-black/50 dark:text-white/50">
                    Invite code: <code className="font-mono">{league.invite_code}</code>
                  </p>
                  {teams.length > 0 && (
                    <ul className="text-xs text-black/60 dark:text-white/60">
                      {teams.map((t) => (
                        <li key={t.team_id}>
                          {t.team_name} — {t.owner_name}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Your team name"
                      value={teamNameByLeague[league.id] ?? ""}
                      onChange={(e) => setTeamNameByLeague((prev) => ({ ...prev, [league.id]: e.target.value }))}
                      className="flex-1 rounded-md border border-black/10 bg-transparent px-2 py-1 text-sm dark:border-white/10"
                    />
                    <button
                      onClick={() => handleCreateTeam(league.id)}
                      disabled={busy}
                      className="rounded-full bg-sky-500 px-3 py-1 text-xs font-semibold text-white disabled:opacity-40"
                    >
                      Create my team
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="neon-panel flex flex-col gap-3 rounded-xl p-4">
        <h2 className="text-sm font-semibold">Create a league</h2>
        <form onSubmit={handleCreateLeague} className="flex gap-2">
          <input
            type="text"
            placeholder="League name"
            value={newLeagueName}
            onChange={(e) => setNewLeagueName(e.target.value)}
            className="flex-1 rounded-md border border-black/10 bg-transparent px-2 py-1 text-sm dark:border-white/10"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-full bg-sky-500 px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
          >
            Create
          </button>
        </form>
      </section>

      <section className="neon-panel flex flex-col gap-3 rounded-xl p-4">
        <h2 className="text-sm font-semibold">Join a league</h2>
        <form onSubmit={handleJoinLeague} className="flex gap-2">
          <input
            type="text"
            placeholder="Invite code"
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
            className="flex-1 rounded-md border border-black/10 bg-transparent px-2 py-1 text-sm dark:border-white/10"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-full border border-black/10 px-4 py-1.5 text-xs font-medium dark:border-white/10"
          >
            Join
          </button>
        </form>
      </section>
    </div>
  );
}
