"use client";

import { useEffect, useState } from "react";
import { getLeagueMembers, getMyLeagues, removeMember, setMemberRole, type League, type Member } from "@/lib/leaguesApi";

/** Split out of the old single-page CommissionerApp.tsx (2026-09-03). */
export function MembersSection() {
  const [league, setLeague] = useState<League | null>(null);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [myUserId, setMyUserId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [roleChangeBusyId, setRoleChangeBusyId] = useState<number | null>(null);
  const [removeConfirmId, setRemoveConfirmId] = useState<number | null>(null);
  const [removeBusyId, setRemoveBusyId] = useState<number | null>(null);

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

      setMembers(await getLeagueMembers(active.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load your league.");
    }
  }

  useEffect(() => {
    const id = setTimeout(refresh, 0);
    return () => clearTimeout(id);
  }, []);

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
                    current team stay untouched — reassign their team separately on the Teams page if needed.
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
    </div>
  );
}
