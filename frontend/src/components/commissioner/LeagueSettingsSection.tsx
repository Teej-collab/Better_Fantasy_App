"use client";

import { useEffect, useState } from "react";
import { getMyLeagues, getPlayoffSettings, renameLeague, updatePlayoffSettings, type League } from "@/lib/leaguesApi";

/**
 * Split out of the old single-page CommissionerApp.tsx (2026-09-03) —
 * name + invite code, the two things every commissioner touches most
 * often. Same client-fetch-on-mount + refresh() shape every other
 * commissioner section in this app uses.
 */
export function LeagueSettingsSection() {
  const [league, setLeague] = useState<League | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const [playoffSeason, setPlayoffSeason] = useState<number | null>(null);
  const [playoffTeamCount, setPlayoffTeamCount] = useState("");
  const [playoffBusy, setPlayoffBusy] = useState(false);
  const [playoffSaved, setPlayoffSaved] = useState(false);

  async function refresh() {
    try {
      const { leagues, activeLeagueId } = await getMyLeagues();
      const active = leagues.find((l) => l.id === activeLeagueId) ?? null;
      setLeague(active);

      const playoff = await getPlayoffSettings();
      setPlayoffSeason(playoff.season);
      setPlayoffTeamCount(playoff.playoff_team_count === null ? "" : String(playoff.playoff_team_count));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load your league.");
    }
  }

  async function savePlayoffTeamCount() {
    if (playoffSeason === null || !playoffTeamCount) return;
    setPlayoffBusy(true);
    setPlayoffSaved(false);
    try {
      await updatePlayoffSettings(playoffSeason, Number(playoffTeamCount));
      setPlayoffSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the playoff format.");
    } finally {
      setPlayoffBusy(false);
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
    <div className="flex flex-col gap-4">
      {error && (
        <p role="alert" className="text-sm text-red-500">
          {error}
        </p>
      )}

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

        {playoffSeason !== null && (
          <div className="flex flex-wrap items-center gap-2 border-t border-black/5 pt-3 dark:border-white/5">
            <span className="text-sm text-black/50 dark:text-white/50">
              Playoff teams ({playoffSeason})
            </span>
            <input
              type="number"
              min={1}
              value={playoffTeamCount}
              onChange={(e) => {
                setPlayoffTeamCount(e.target.value);
                setPlayoffSaved(false);
              }}
              placeholder="Not set"
              className="w-20 rounded-lg border border-black/10 bg-transparent px-2 py-1 text-sm tabular-nums dark:border-white/10"
            />
            <button
              onClick={savePlayoffTeamCount}
              disabled={playoffBusy || !playoffTeamCount}
              className="rounded-full bg-[var(--wl-accent-dim)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
            >
              {playoffBusy ? "Saving…" : "Save"}
            </button>
            {playoffSaved && <span className="text-xs text-emerald-600 dark:text-emerald-400">Saved.</span>}
            <p className="w-full text-xs text-black/50 dark:text-white/50">
              Drives the playoff-picture line on the standings page. Without this, it&apos;s inferred from last
              season&apos;s real bracket once one exists.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
