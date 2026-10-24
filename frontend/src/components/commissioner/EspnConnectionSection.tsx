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
  const [link, setLink] = useState("");
  const [showPrivate, setShowPrivate] = useState(false);
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
    if (!link.trim()) {
      setPanel({ status: "error", message: "Paste your league's link from ESPN." });
      return;
    }
    if (showPrivate && (!espnS2.trim() || !espnSwid.trim())) {
      setPanel({ status: "error", message: "Add both espn_s2 and SWID, or leave both empty." });
      return;
    }
    setPanel({ status: "connecting" });
    try {
      await connectEspn(link.trim(), showPrivate ? espnS2.trim() : undefined, showPrivate ? espnSwid.trim() : undefined);
      setStatus(await getEspnConnection());
      setEspnS2("");
      setEspnSwid("");
      setPanel({ status: "idle" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Couldn't connect that ESPN league.";
      setPanel({ status: "error", message });
      if (message.includes("is private")) setShowPrivate(true);
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
          Bring your ESPN league in: teams, matchups and live scores, with everything else here built on top.
        </p>
      </div>

      {status.connected ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1 text-sm">
            <span className="text-black/70 dark:text-white/70">
              Connected to ESPN league <span className="font-medium">{status.espn_league_id}</span>
              {status.public ? " (public)" : ""}
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
            <span className="text-black/70 dark:text-white/70">1. Your league&apos;s ESPN link</span>
            <span className="text-xs text-black/45 dark:text-white/45">
              Open your league at fantasy.espn.com and copy the address from the browser bar. It has leagueId= in it. Just the number
              works too.
            </span>
            <input
              type="text"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="https://fantasy.espn.com/football/league?leagueId=…"
              className={FIELD_CLASS}
            />
          </label>
          <div className="flex flex-col gap-1 text-sm">
            <span className="text-black/70 dark:text-white/70">2. Turn on &ldquo;Viewable to Public&rdquo;</span>
            <span className="text-xs text-black/45 dark:text-white/45">
              In ESPN as the league manager: League Manager → Settings → Basic Settings → &ldquo;Make League Viewable to
              Public.&rdquo; Your league stays private and your rules don&apos;t change; this only lets The Weekend read your
              scores. You can turn it off anytime.
            </span>
          </div>
          {showPrivate ? (
            <>
              <p className="text-xs text-black/55 dark:text-white/55">
                Keeping it private? Sign in at espn.com, open your browser&apos;s developer tools → Application → Cookies →
                espn.com, and copy espn_s2 and SWID (with the curly braces).
              </p>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-black/70 dark:text-white/70">espn_s2</span>
                <input type="password" autoComplete="off" value={espnS2} onChange={(e) => setEspnS2(e.target.value)} className={FIELD_CLASS} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-black/70 dark:text-white/70">SWID</span>
                <input type="text" autoComplete="off" value={espnSwid} onChange={(e) => setEspnSwid(e.target.value)} className={FIELD_CLASS} />
              </label>
            </>
          ) : (
            <button type="button" onClick={() => setShowPrivate(true)} className="w-fit text-sm font-semibold underline">
              My league is private
            </button>
          )}

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
