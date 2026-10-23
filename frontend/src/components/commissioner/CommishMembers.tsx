"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { buttonClass, inputClass, panelClass } from "@/components/commissioner/CommishBits";
import { commishApi, timeAgo, TONES, type CommishMember } from "@/lib/commishApi";
import { createTeamForMember, reassignTeam, removeMember, setMemberRole } from "@/lib/leaguesApi";
import { NAV_ACCENT } from "@/lib/navDestinations";

// Members & teams (2026-10-23 overhaul, mockup 4): the old Members and
// Teams pages in one. Each member shows their team, record, role and
// when they were last around; open one for what you can do. Same as the
// app's mobile/src/app/commissioner/members.tsx.

const QUIET_DAYS = 10;
const AVATAR_COLORS = ["#39ff14", "#38bdf8", "#f472b6", "#facc15", "#a855f7", "#fb923c", "#2dd4bf", "#f87171"];

function isQuiet(lastActiveAt: string | null): boolean {
  return !lastActiveAt || Date.now() - new Date(lastActiveAt).getTime() > QUIET_DAYS * 86_400_000;
}

type Data = { league_id: number; invite_code: string; me: number; members: CommishMember[] };

export function CommishMembers() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    commishApi
      .members()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load your members."));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <p className="text-sm text-red-500">{error}</p>;
  if (!data) return <p className="text-sm text-black/50 dark:text-white/50">Loading…</p>;

  const term = search.trim().toLowerCase();
  const members = data.members.filter(
    (m) => !term || m.display_name.toLowerCase().includes(term) || (m.team?.team_name ?? "").toLowerCase().includes(term),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className={`${panelClass} flex items-center gap-3 p-4`}>
        <div className="flex flex-1 flex-col">
          <span className="text-sm text-black/55 dark:text-white/55">Invite code</span>
          <span className="font-display text-2xl tracking-widest">{data.invite_code}</span>
        </div>
        <button
          type="button"
          className={buttonClass}
          style={{ backgroundColor: NAV_ACCENT }}
          onClick={async () => {
            await navigator.clipboard.writeText(`${window.location.origin}/start?join=${encodeURIComponent(data.invite_code)}`).catch(() => {});
            setCopied(true);
          }}
        >
          {copied ? "Link copied" : "Copy invite link"}
        </button>
      </div>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Find a member or team"
        aria-label="Find a member or team"
        className={inputClass}
      />
      <div className="flex flex-col gap-2">
        {members.map((m, i) => (
          <MemberCard
            key={m.user_id}
            member={m}
            color={AVATAR_COLORS[i % AVATAR_COLORS.length]}
            isMe={m.user_id === data.me}
            open={open === m.user_id}
            onToggle={() => setOpen(open === m.user_id ? null : m.user_id)}
            leagueId={data.league_id}
            everyone={data.members}
            onChanged={load}
          />
        ))}
      </div>
    </div>
  );
}

const smallButton = "rounded-full px-3.5 py-1.5 text-sm font-bold disabled:opacity-50";

function MemberCard({ member: m, color, isMe, open, onToggle, leagueId, everyone, onChanged }: {
  member: CommishMember;
  color: string;
  isMe: boolean;
  open: boolean;
  onToggle: () => void;
  leagueId: number;
  everyone: CommishMember[];
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [giveTo, setGiveTo] = useState("");
  const [teamName, setTeamName] = useState("");
  const quiet = !!m.team && isQuiet(m.last_active_at);
  const record = m.team ? `${m.team.wins}–${m.team.losses}${m.team.ties ? `–${m.team.ties}` : ""}` : null;

  async function run(label: string, fn: () => Promise<unknown>, fallback: string) {
    setBusy(label);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : fallback);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={`${panelClass} flex flex-col gap-3 p-3`} style={quiet ? { borderColor: `${TONES.orange}88` } : undefined}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex items-center gap-3 text-left">
        {m.photo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={m.photo_url} alt="" className="size-10 shrink-0 rounded-full object-cover" />
        ) : (
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full font-extrabold text-black" style={{ backgroundColor: color }}>
            {m.display_name.charAt(0).toUpperCase()}
          </span>
        )}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-bold">
            {m.display_name}
            {isMe && <span className="font-normal text-black/50 dark:text-white/50"> (you)</span>}
            {m.role === "commissioner" && <span className="ml-2 text-[10px] font-extrabold tracking-wider text-violet-400">{isMe ? "COMMISH" : "CO-COMMISH"}</span>}
          </span>
          <span className="truncate text-sm text-black/60 dark:text-white/60" style={!m.team ? { color: TONES.purple } : undefined}>
            {m.team ? `${m.team.team_name} · ${record}` : "No team yet"}
          </span>
        </span>
        <span className="text-xs font-semibold text-black/55 dark:text-white/55" style={quiet ? { color: TONES.orange } : undefined}>
          {timeAgo(m.last_active_at)}
        </span>
      </button>

      {open && !isMe && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!!busy}
              className={`${smallButton} bg-black/5 dark:bg-white/10`}
              onClick={() => run("role", () => setMemberRole(leagueId, m.user_id, m.role === "commissioner" ? "member" : "commissioner"), "Couldn't change their role.")}
            >
              {m.role === "commissioner" ? "Make regular member" : "Make co-commish"}
            </button>
            {m.team && (
              <Link href={`/commissioner/lineup?team=${m.team.team_id}`} className={`${smallButton} bg-black/5 dark:bg-white/10`}>
                Fix their lineup
              </Link>
            )}
          </div>
          {m.team ? (
            <div className="flex flex-wrap items-center gap-2">
              <select value={giveTo} onChange={(e) => setGiveTo(e.target.value)} className={inputClass} aria-label="Give their team to">
                <option value="">Give their team to…</option>
                {everyone
                  .filter((o) => o.user_id !== m.user_id && !o.team)
                  .map((o) => (
                    <option key={o.user_id} value={o.user_id}>
                      {o.display_name}
                    </option>
                  ))}
              </select>
              {giveTo && (
                <button
                  type="button"
                  disabled={!!busy}
                  className={`${smallButton} bg-black/5 dark:bg-white/10`}
                  onClick={() => run("give", () => reassignTeam(leagueId, m.team!.team_id, Number(giveTo)), "Couldn't give that team away.")}
                >
                  {busy === "give" ? "Giving…" : "Give team"}
                </button>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <input value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="Team name" className={`${inputClass} flex-1`} />
              <button
                type="button"
                disabled={!!busy || !teamName.trim()}
                className={`${smallButton} bg-black/5 dark:bg-white/10`}
                onClick={() => run("team", () => createTeamForMember(leagueId, m.user_id, teamName.trim()), "Couldn't make their team.")}
              >
                {busy === "team" ? "Making…" : "Make their team"}
              </button>
            </div>
          )}
          {confirmRemove ? (
            <div className="flex flex-col gap-2 rounded-lg border border-red-500/40 p-3">
              <span className="text-sm">Remove {m.display_name}? They lose access to the league. Their team and history stay.</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={!!busy}
                  className={`${smallButton} bg-red-500/15 text-red-500`}
                  onClick={() => run("remove", () => removeMember(leagueId, m.user_id), "Couldn't remove them.")}
                >
                  {busy === "remove" ? "Removing…" : "Yes, remove"}
                </button>
                <button type="button" className={`${smallButton} bg-black/5 dark:bg-white/10`} onClick={() => setConfirmRemove(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className={`${smallButton} self-start bg-red-500/10 text-red-500`} onClick={() => setConfirmRemove(true)}>
              Remove from league…
            </button>
          )}
          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>
      )}
    </div>
  );
}
