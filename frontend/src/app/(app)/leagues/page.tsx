"use client";

import { useEffect, useRef, useState } from "react";
import {
  claimOwner,
  createLeague,
  createTeam,
  getLeagueMembers,
  getLeagueTeams,
  getMyLeagues,
  getUnclaimedOwners,
  joinLeague,
  renameLeague,
  selectLeague,
  setMemberRole,
  type League,
  type Member,
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
  const [membersByLeague, setMembersByLeague] = useState<Record<number, Member[]>>({});
  const [myUserId, setMyUserId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [switchingId, setSwitchingId] = useState<number | null>(null);
  const [claimingOwnerId, setClaimingOwnerId] = useState<number | null>(null);
  const [changingRoleUserId, setChangingRoleUserId] = useState<number | null>(null);
  const [renamingLeagueId, setRenamingLeagueId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [copiedInviteCodeId, setCopiedInviteCodeId] = useState<number | null>(null);

  function copyInviteCode(leagueId: number, inviteCode: string) {
    navigator.clipboard.writeText(inviteCode).then(() => {
      setCopiedInviteCodeId(leagueId);
      setTimeout(() => setCopiedInviteCodeId((current) => (current === leagueId ? null : current)), 2000);
    });
  }

  const [newLeagueName, setNewLeagueName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [teamNameByLeague, setTeamNameByLeague] = useState<Record<number, string>>({});

  async function refresh() {
    try {
      const { leagues: mine, activeLeagueId: active } = await getMyLeagues();
      setLeagues(mine);
      setActiveLeagueId(active);
      // /auth/me directly (not a leaguesApi helper — it's account-level,
      // not league-scoped), same same-origin route AuthStatus.tsx uses,
      // just for the caller's own user_id: needed to hide the promote/
      // demote controls on your own member row below, matching the
      // backend's own can't-change-your-own-role guard.
      const me = await fetch("/auth/me")
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null);
      setMyUserId(me?.user_id ?? null);
      const [teamLists, unclaimedLists, memberLists] = await Promise.all([
        Promise.all(mine.map((l) => getLeagueTeams(l.id).catch(() => [] as Team[]))),
        Promise.all(mine.map((l) => getUnclaimedOwners(l.id).catch(() => [] as UnclaimedOwner[]))),
        Promise.all(mine.map((l) => getLeagueMembers(l.id).catch(() => [] as Member[]))),
      ]);
      setTeamsByLeague(Object.fromEntries(mine.map((l, i) => [l.id, teamLists[i]])));
      setUnclaimedByLeague(Object.fromEntries(mine.map((l, i) => [l.id, unclaimedLists[i]])));
      setMembersByLeague(Object.fromEntries(mine.map((l, i) => [l.id, memberLists[i]])));
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

  async function handleRenameLeague(leagueId: number) {
    const name = renameValue.trim();
    if (!name) return;
    setRenameBusy(true);
    setError(null);
    try {
      await renameLeague(leagueId, name);
      setRenamingLeagueId(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't rename that league");
    } finally {
      setRenameBusy(false);
    }
  }

  async function handleSetMemberRole(leagueId: number, userId: number, role: "commissioner" | "member") {
    setChangingRoleUserId(userId);
    setError(null);
    try {
      await setMemberRole(leagueId, userId, role);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't change that member's role");
    } finally {
      setChangingRoleUserId(null);
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
              const members = membersByLeague[league.id] ?? [];
              const isActive = league.id === activeLeagueId;
              return (
                <div key={league.id} className="flex flex-col gap-2 rounded-lg border border-black/10 p-3 dark:border-white/10">
                  <div className="flex items-center justify-between gap-2">
                    {renamingLeagueId === league.id ? (
                      <span className="flex flex-1 items-center gap-2">
                        <input
                          type="text"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          maxLength={40}
                          autoFocus
                          className="w-40 rounded-md border border-black/10 bg-transparent px-2 py-1 text-sm font-medium dark:border-white/10"
                        />
                        <button
                          onClick={() => handleRenameLeague(league.id)}
                          disabled={renameBusy || !renameValue.trim()}
                          className="rounded-full px-2.5 py-1 text-xs font-semibold disabled:opacity-40"
                          style={{ background: "var(--user-accent, var(--wl-accent))", color: "#06110a" }}
                        >
                          {renameBusy ? "Saving…" : "Save"}
                        </button>
                        <button
                          onClick={() => setRenamingLeagueId(null)}
                          disabled={renameBusy}
                          className="text-xs text-black/50 hover:underline dark:text-white/50"
                        >
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <span className="font-medium">{league.name}</span>
                        <span className="rounded-full border border-black/10 px-2 py-0.5 text-xs text-black/60 dark:border-white/10 dark:text-white/60">
                          {league.role}
                        </span>
                        {league.role === "commissioner" && (
                          <button
                            onClick={() => {
                              setRenamingLeagueId(league.id);
                              setRenameValue(league.name);
                            }}
                            className="text-xs text-black/50 hover:underline dark:text-white/50"
                          >
                            Rename
                          </button>
                        )}
                      </span>
                    )}
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
                  <p className="flex flex-wrap items-center gap-2 text-xs text-black/50 dark:text-white/50">
                    <span>
                      Invite code: <code className="font-mono">{league.invite_code}</code>
                    </span>
                    <button
                      onClick={() => copyInviteCode(league.id, league.invite_code)}
                      className="rounded-full border border-black/10 px-2 py-0.5 text-[11px] hover:bg-black/[0.03] dark:border-white/10 dark:hover:bg-white/[0.05]"
                    >
                      {copiedInviteCodeId === league.id ? "Copied!" : "Copy"}
                    </button>
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

                  {league.role === "commissioner" && members.length > 0 && (
                    <div className="mt-1 flex flex-col gap-1.5 rounded-md bg-black/[0.02] p-2.5 dark:bg-white/[0.03]">
                      <p className="text-xs text-black/60 dark:text-white/60">Members</p>
                      <ul className="flex flex-col gap-1.5">
                        {members.map((member) => (
                          <li key={member.user_id} className="flex items-center justify-between gap-2 text-xs">
                            <span className="flex items-center gap-1.5">
                              <span>{member.display_name}</span>
                              <span className="rounded-full border border-black/10 px-1.5 py-0.5 text-[10px] text-black/60 dark:border-white/10 dark:text-white/60">
                                {member.role}
                              </span>
                            </span>
                            {member.user_id !== myUserId && (
                              <button
                                onClick={() =>
                                  handleSetMemberRole(
                                    league.id,
                                    member.user_id,
                                    member.role === "commissioner" ? "member" : "commissioner"
                                  )
                                }
                                disabled={changingRoleUserId === member.user_id}
                                className="shrink-0 rounded-full border border-black/10 px-2.5 py-1 text-xs hover:bg-black/5 disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/10"
                              >
                                {changingRoleUserId === member.user_id
                                  ? "Saving…"
                                  : member.role === "commissioner"
                                    ? "Remove commissioner"
                                    : "Make commissioner"}
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

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
