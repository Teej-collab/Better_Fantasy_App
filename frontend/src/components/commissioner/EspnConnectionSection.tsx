"use client";

import { useEffect, useState } from "react";
import {
  connectEspn,
  disconnectEspn,
  getEspnConnection,
  syncEspnNow,
  type EspnConnectionStatus,
} from "@/lib/leaguesApi";

type Panel =
  | { status: "idle" }
  | { status: "connecting" }
  | { status: "syncing" }
  | { status: "disconnecting" }
  | { status: "error"; message: string };

const FIELD_CLASS =
  "rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--wl-accent)] dark:border-white/10";

/**
 * Phase 6 of the multi-league migration (see backend/TODO.md's PHASE 9
 * entry) — lets this league's commissioner connect their OWN real ESPN
 * league, instead of ESPN_LEAGUE_ID/S2/SWID only ever describing
 * League #1. Same shape as ScoringRulesSection.tsx (load on mount, a
 * form, a save/action button, inline saved/error state) for
 * consistency with the rest of Commissioner Tools.
 *
 * Deliberately no automatic scheduled sync yet — this phase only ever
 * ships an on-demand "Sync now" button (see the backend router's own
 * docstring for why: the 4 scheduled jobs still only sync League #1
 * automatically, a separate, larger piece of work). A commissioner who
 * wants fresh data re-clicks Sync now, same as League #1's admin panel
 * already requires for a manual trigger.
 */
export function EspnConnectionSection() {
  const [status, setStatus] = useState<EspnConnectionStatus | null>(null);
  const [espnLeagueId, setEspnLeagueId] = useState("");
  const [espnS2, setEspnS2] = useState("");
  const [espnSwid, setEspnSwid] = useState("");
  const [panel, setPanel] = useState<Panel>({ status: "idle" });

  useEffect(() => {
    getEspnConnection()
      .then(setStatus)
      .catch((err) => setPanel({ status: "error", message: err instanceof Error ? err.message : "Couldn't load ESPN connection status." }));
  }, []);

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    const leagueId = Number(espnLeagueId);
    if (!Number.isFinite(leagueId) || leagueId <= 0) {
      setPanel({ status: "error", message: "Enter a valid ESPN League ID." });
      return;
    }
    if (!espnS2.trim() || !espnSwid.trim()) {
      setPanel({ status: "error", message: "ESPN_S2 and SWID are both required." });
      return;
    }
    setPanel({ status: "connecting" });
    try {
      await connectEspn(leagueId, espnS2.trim(), espnSwid.trim());
      setStatus(await getEspnConnection());
      setEspnS2("");
      setEspnSwid("");
      setPanel({ status: "idle" });
    } catch (err) {
      setPanel({ status: "error", message: err instanceof Error ? err.message : "Couldn't connect that ESPN league." });
    }
  }

  async function handleSync() {
    setPanel({ status: "syncing" });
    try {
      await syncEspnNow();
      setStatus(await getEspnConnection());
      setPanel({ status: "idle" });
    } catch (err) {
      setPanel({ status: "error", message: err instanceof Error ? err.message : "Sync failed." });
    }
  }

  async function handleDisconnect() {
    setPanel({ status: "disconnecting" });
    try {
      await disconnectEspn();
      setStatus({ connected: false });
      setPanel({ status: "idle" });
    } catch (err) {
      setPanel({ status: "error", message: err instanceof Error ? err.message : "Couldn't disconnect." });
    }
  }

  if (status === null) {
    return panel.status === "error" ? <p className="text-sm text-red-500">{panel.message}</p> : null;
  }

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">ESPN Connection</h2>
        <p className="text-sm text-black/50 dark:text-white/50">
          Import teams, matchups, and standings from a real ESPN league into this league.
        </p>
      </div>

      {status.connected ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1 text-sm">
            <span className="text-black/70 dark:text-white/70">
              Connected to ESPN league <span className="font-medium">{status.espn_league_id}</span>
            </span>
            <span className="text-black/50 dark:text-white/50">
              {status.last_synced_at
                ? `Last synced ${new Date(status.last_synced_at).toLocaleString()}`
                : "Never synced yet"}
            </span>
            {status.last_sync_error && (
              <span className="text-red-500">Last sync failed: {status.last_sync_error}</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleSync}
              disabled={panel.status === "syncing" || panel.status === "disconnecting"}
              className="w-fit rounded-full bg-[var(--wl-accent)] px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
            >
              {panel.status === "syncing" ? "Syncing…" : "Sync now"}
            </button>
            <button
              onClick={handleDisconnect}
              disabled={panel.status === "syncing" || panel.status === "disconnecting"}
              className="w-fit rounded-full border border-black/10 px-4 py-2 text-sm font-medium text-black/70 disabled:opacity-40 dark:border-white/10 dark:text-white/70"
            >
              {panel.status === "disconnecting" ? "Disconnecting…" : "Disconnect"}
            </button>
          </div>
          {panel.status === "error" && <span className="text-sm text-red-500">{panel.message}</span>}
        </div>
      ) : (
        <form onSubmit={handleConnect} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-black/70 dark:text-white/70">ESPN League ID</span>
            <span className="text-xs text-black/45 dark:text-white/45">
              The number in your league&apos;s ESPN URL (fantasy.espn.com/football/league?leagueId=...).
            </span>
            <input
              type="text"
              inputMode="numeric"
              value={espnLeagueId}
              onChange={(e) => setEspnLeagueId(e.target.value)}
              className={FIELD_CLASS}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-black/70 dark:text-white/70">ESPN_S2</span>
            <span className="text-xs text-black/45 dark:text-white/45">
              From a private league only — your browser&apos;s espn_s2 cookie value while signed into ESPN.
            </span>
            <input
              type="password"
              autoComplete="off"
              value={espnS2}
              onChange={(e) => setEspnS2(e.target.value)}
              className={FIELD_CLASS}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-black/70 dark:text-white/70">SWID</span>
            <span className="text-xs text-black/45 dark:text-white/45">
              Your browser&apos;s SWID cookie value, including the curly braces.
            </span>
            <input
              type="text"
              autoComplete="off"
              value={espnSwid}
              onChange={(e) => setEspnSwid(e.target.value)}
              className={FIELD_CLASS}
            />
          </label>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={panel.status === "connecting"}
              className="w-fit rounded-full bg-[var(--wl-accent)] px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
            >
              {panel.status === "connecting" ? "Connecting…" : "Connect ESPN league"}
            </button>
            {panel.status === "error" && <span className="text-sm text-red-500">{panel.message}</span>}
          </div>
        </form>
      )}
    </section>
  );
}
