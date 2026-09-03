"use client";

import { useEffect, useState } from "react";
import {
  getLeagueMembers,
  getLeagueTeams,
  getMyLeagues,
  reassignTeam,
  removeMember,
  renameLeague,
  setMemberRole,
  type League,
  type Member,
  type Team,
} from "@/lib/leaguesApi";
import { ScoringRulesSection } from "@/components/commissioner/ScoringRulesSection";
import { TradeSettingsAndReview } from "@/components/commissioner/TradeSettingsAndReview";

/**
 * The commissioner's own dashboard for the currently active league —
 * league settings, scoring, members, teams, and trade settings/review
 * all in one place, modeled on ESPN/Sleeper's own commissioner tools.
 * Same client-fetch-on-mount + refresh() shape as leagues/page.tsx
 * (the closest existing precedent), just scoped to one league instead
 * of every league the caller belongs to.
 */
export function CommissionerApp() {
  const [league, setLeague] = useState<League | null>(null);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [myUserId, setMyUserId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);

  const [roleChangeBusyId, setRoleChangeBusyId] = useState<number | null>(null);
  const [removeConfirmId, setRemoveConfirmId] = useState<number | null>(null);
  const [removeBusyId, setRemoveBusyId] = useState<number | null>(null);

  const [reassignTeamId, setReassignTeamId] = useState<number | null>(null);
  const [reassignTargetUserId, setReassignTargetUserId] = useState<number | "">("");
  const [reassignBusy, setReassignBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function refresh() {
    try {
      const { leagues, activeLeagueId } = await getMyLeagues();
      const active = leagues.find((l) => l.id === activeLeagueId) ?? null;
      setLeague(active);
      if (!active) return;

      const me = await fetch("/auth/me")
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null);
      setMyUserId(me?.user_id ?? null);

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

  async function saveRename() {
    if (!league || !renameValue.trim()) return;
    setRenameBusy(true);
    try {
      const updated = await renameLeague(league.id, renameValue.trim());
      setLeague({ ...league, name: updated.name });
      setRenaming(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't rename the league.");
    } finally {
      setRenameBusy(false);
    }
  }

  async function changeRole(userId: number, role: "commissioner" | "member") {
    if (!league) return;
    setRoleChangeBusyId(userId);
    try {
      await setMemberRole(league.id, userId, role);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't change that member's role.");
    } finally {
      setRoleChangeBusyId(null);
    }
  }

  async function confirmRemove(userId: number) {
    if (!league) return;
    setRemoveBusyId(userId);
    try {
      await removeMember(league.id, userId);
      setRemoveConfirmId(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't remove that member.");
    } finally {
      setRemoveBusyId(null);
    }
  }

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

  function copyInviteCode() {
    if (!league) return;
    navigator.clipboard.writeText(league.invite_code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (league === null) {
    return error ? <p className="text-sm text-red-500">{error}</p> : null;
  }

  return (
    <div className="flex flex-col gap-8">
      {error && (
        <p role="alert" className="text-sm text-red-500">
          {error}
        </p>
      )}

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-semibold">League Settings</h2>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-black/50 dark:text-white/50">Name</span>
            {renaming ? (
              <>
                <input
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  className="rounded-lg border border-black/10 bg-transparent px-2 py-1 text-sm dark:border-white/10"
                  maxLength={40}
                />
                <button
                  onClick={saveRename}
                  disabled={renameBusy || !renameValue.trim()}
                  className="rounded-full bg-[var(--wl-accent-dim)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                >
                  {renameBusy ? "Saving…" : "Save"}
                </button>
                <button onClick={() => setRenaming(false)} className="text-xs text-black/50 hover:underline dark:text-white/50">
                  Cancel
                </button>
              </>
            ) : (
              <>
                <span className="font-medium">{league.name}</span>
                <button
                  onClick={() => {
                    setRenameValue(league.name);
                    setRenaming(true);
                  }}
                  className="text-xs text-black/50 hover:underline dark:text-white/50"
                >
                  Rename
                </button>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-black/50 dark:text-white/50">Invite code</span>
            <code className="rounded-lg border border-black/10 px-2 py-1 font-mono text-sm dark:border-white/10">
              {league.invite_code}
            </code>
            <button
              onClick={copyInviteCode}
              className="rounded-full border border-black/10 px-3 py-1.5 text-xs hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>
      </section>

      <ScoringRulesSection />

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Members</h2>
        {members === null || members.length === 0 ? (
          <p className="text-sm text-black/50 dark:text-white/50">No members yet.</p>
        ) : (
          <ul className="neon-panel flex flex-col divide-y divide-black/5 rounded-lg bg-black/[0.015] dark:divide-white/5 dark:bg-white/[0.03]">
            {members.map((m) => (
              <li key={m.user_id} className="flex flex-col gap-2 px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {m.display_name}{" "}
                    <span className="text-xs text-black/50 dark:text-white/50">
                      {m.role === "commissioner" ? "· Commissioner" : ""}
                    </span>
                  </span>
                  {m.user_id !== myUserId && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => changeRole(m.user_id, m.role === "commissioner" ? "member" : "commissioner")}
                        disabled={roleChangeBusyId === m.user_id}
                        className="rounded-full border border-black/10 px-3 py-1 text-xs hover:bg-black/5 disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/10"
                      >
                        {m.role === "commissioner" ? "Demote" : "Promote"}
                      </button>
                      <button
                        onClick={() => setRemoveConfirmId(m.user_id)}
                        className="rounded-full border border-red-500/30 px-3 py-1 text-xs text-red-500 hover:bg-red-500/10"
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </div>

                {removeConfirmId === m.user_id && (
                  <div className="flex flex-col gap-2 rounded-lg border border-red-500/30 bg-red-500/[0.03] p-3">
                    <p className="text-xs text-black/70 dark:text-white/70">
                      Remove {m.display_name} from this league? They&apos;ll lose access, but their history and any
                      current team stay untouched — reassign their team separately below if needed.
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => confirmRemove(m.user_id)}
                        disabled={removeBusyId === m.user_id}
                        className="w-fit rounded-full bg-red-500 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                      >
                        {removeBusyId === m.user_id ? "Removing…" : "Confirm remove"}
                      </button>
                      <button
                        onClick={() => setRemoveConfirmId(null)}
                        className="w-fit rounded-full border border-black/10 px-3 py-1.5 text-xs dark:border-white/10"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Teams</h2>
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
      </section>

      <TradeSettingsAndReview />
    </div>
  );
}
