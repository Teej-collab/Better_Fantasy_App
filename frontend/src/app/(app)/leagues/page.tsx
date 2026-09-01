"use client";

import { useEffect, useRef, useState } from "react";
import {
  claimOwner,
  createLeague,
  createTeam,
  getLeagueTeams,
  getMyLeagues,
  getUnclaimedOwners,
  joinLeague,
  selectLeague,
  type League,
  type Team,
  type UnclaimedOwner,
} from "@/lib/leaguesApi";

/**
 * Self-serve create/join-a-league + create-your-team + switch-active-
 * league + claim-your-history flow (see backend TODO.md's PHASE 9
 * entry, "session-resolved active league"). Every personal/session-
 * gated route (My Team, Draft, Keepers, Chug, Settings, Admin) now
 * reads the caller's own active_league_id (set here, via POST
 * /leagues/{id}/select) instead of always implicitly acting on League
 * #1 — this page is the one place that active league actually gets
 * chosen. The public, unauthenticated browse routes (Standings,
 * Matchups, Records, Power Rankings — routers/league.py) are a
 * deliberately separate, larger, not-yet-built piece of work: making
 * those league-aware needs a real "which league am I browsing" URL/UI
 * concept of their own, not just a session-resolved default.
 */
export default function LeaguesPage() {
  const [leagues, setLeagues] = useState<League[] | null>(null);
  const [activeLeagueId, setActiveLeagueId] = useState<number | null>(null);
  const [teamsByLeague, setTeamsByLeague] = useState<Record<number, Team[]>>({});
  const [unclaimedByLeague, setUnclaimedByLeague] = useState<Record<number, UnclaimedOwner[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [switchingId, setSwitchingId] = useState<number | null>(null);
  const [claimingOwnerId, setClaimingOwnerId] = useState<number | null>(null);

  const [newLeagueName, setNewLeagueName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [teamNameByLeague, setTeamNameByLeague] = useState<Record<number, string>>({});

  async function refresh() {
    try {
      const { leagues: mine, activeLeagueId: active } = await getMyLeagues();
      setLeagues(mine);
      setActiveLeagueId(active);
      const [teamLists, unclaimedLists] = await Promise.all([
        Promise.all(mine.map((l) => getLeagueTeams(l.id).catch(() => [] as Team[]))),
        Promise.all(mine.map((l) => getUnclaimedOwners(l.id).catch(() => [] as UnclaimedOwner[]))),
      ]);
      setTeamsByLeague(Object.fromEntries(mine.map((l, i) => [l.id, teamLists[i]])));
      setUnclaimedByLeague(Object.fromEntries(mine.map((l, i) => [l.id, unclaimedLists[i]])));
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

  // Deep links here (the welcome screen's Join/Create-a-League buttons,
  // WelcomeBackStage.tsx) carry a #join-league / #create-league hash,
  // but this page shows a bare "Loading…" state until refresh() above
  // resolves — the target section doesn't exist in the DOM yet at
  // navigation time, so the browser's own hash-scroll fires too early
  // and silently does nothing. Scrolling manually once real content is
  // up fixes that; scrolledToHash guards it to the first load only, so
  // a later refresh() (after creating/joining/switching) never yanks
  // the scroll position back to the hash target again.
  const scrolledToHash = useRef(false);
  useEffect(() => {
    if (leagues === null || scrolledToHash.current) return;
    scrolledToHash.current = true;
    const hash = window.location.hash.slice(1);
    if (!hash) return;
    document.getElementById(hash)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [leagues]);

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

  async function handleSwitchLeague(leagueId: number) {
    setSwitchingId(leagueId);
    setError(null);
    try {
      await selectLeague(leagueId);
      setActiveLeagueId(leagueId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't switch leagues");
    } finally {
      setSwitchingId(null);
    }
  }

  async function handleClaimOwner(leagueId: number, ownerId: number) {
    setClaimingOwnerId(ownerId);
    setError(null);
    try {
      await claimOwner(leagueId, ownerId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't claim that history — someone may have already claimed it.");
    } finally {
      setClaimingOwnerId(null);
    }
  }

  if (leagues === null) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="font-display text-2xl font-semibold tracking-wide uppercase">Leagues</h1>
        <p className="text-sm text-black/60 dark:text-white/60">Loading…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold tracking-wide uppercase">Leagues</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          Join an existing league with the invite code your commissioner shares, or start a new one of your own.
        </p>
      </div>
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
              const unclaimed = unclaimedByLeague[league.id] ?? [];
              const isActive = league.id === activeLeagueId;
              return (
                <div key={league.id} className="flex flex-col gap-2 rounded-lg border border-black/10 p-3 dark:border-white/10">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <span className="font-medium">{league.name}</span>
                      <span className="rounded-full border border-black/10 px-2 py-0.5 text-xs text-black/60 dark:border-white/10 dark:text-white/60">
                        {league.role}
                      </span>
                    </span>
                    {isActive ? (
                      <span
                        className="rounded-full px-2.5 py-1 text-xs font-semibold"
                        style={{ background: "var(--user-accent, var(--wl-accent))", color: "#06110a" }}
                      >
                        Active
                      </span>
                    ) : (
                      <button
                        onClick={() => handleSwitchLeague(league.id)}
                        disabled={switchingId === league.id}
                        className="rounded-full border border-black/10 px-2.5 py-1 text-xs font-medium hover:bg-black/[0.03] disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/[0.05]"
                      >
                        {switchingId === league.id ? "Switching…" : "Switch to this league"}
                      </button>
                    )}
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
                      className="rounded-full px-3 py-1 text-xs font-semibold disabled:opacity-40"
                      style={{ background: "var(--user-accent, var(--wl-accent))", color: "#06110a" }}
                    >
                      Create my team
                    </button>
                  </div>

                  {unclaimed.length > 0 && (
                    <div className="mt-1 flex flex-col gap-1.5 rounded-md bg-black/[0.02] p-2.5 dark:bg-white/[0.03]">
                      <p className="text-xs text-black/60 dark:text-white/60">
                        Already played in this league before? Claim your existing team&apos;s history — chug
                        debts, keeper picks, past seasons, and awards all come with it.
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {unclaimed.map((owner) => (
                          <button
                            key={owner.owner_id}
                            onClick={() => handleClaimOwner(league.id, owner.owner_id)}
                            disabled={claimingOwnerId === owner.owner_id}
                            className="rounded-full border border-black/10 px-3 py-1 text-xs hover:bg-black/5 disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/10"
                          >
                            {claimingOwnerId === owner.owner_id ? "Claiming…" : `This is me: ${owner.display_name}`}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section id="create-league" className="neon-panel flex scroll-mt-4 flex-col gap-3 rounded-xl p-4">
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
            className="rounded-full px-4 py-1.5 text-xs font-semibold disabled:opacity-40"
            style={{ background: "var(--user-accent, var(--wl-accent))", color: "#06110a" }}
          >
            Create
          </button>
        </form>
      </section>

      <section id="join-league" className="neon-panel flex scroll-mt-4 flex-col gap-3 rounded-xl p-4">
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
