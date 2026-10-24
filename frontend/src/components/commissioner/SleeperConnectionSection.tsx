"use client";

import { useEffect, useState } from "react";
import {
  connectSleeper,
  disconnectSleeper,
  getSleeperConnection,
  getSleeperLeagues,
  syncSleeperNow,
  type SleeperConnectionStatus,
  type SleeperLeagueOption,
} from "@/lib/leaguesApi";

const FIELD_CLASS =
  "rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--wl-accent)] dark:border-white/10";

type Busy = "connecting" | "syncing" | "disconnecting" | null;

/**
 * A league brought in from Sleeper (2026-10-24): its link or id, nothing
 * else (Sleeper's league API needs no sign-in). Teams, matchups and live
 * scores sync in like an ESPN connection. Same as the app's SleeperPanel
 * in mobile/src/app/commissioner/espn.tsx.
 */
export function SleeperConnectionSection() {
  const [status, setStatus] = useState<SleeperConnectionStatus | null>(null);
  const [link, setLink] = useState("");
  const [username, setUsername] = useState("");
  const [options, setOptions] = useState<SleeperLeagueOption[] | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSleeperConnection()
      .then(setStatus)
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load the Sleeper connection."));
  }, []);

  async function run(next: Busy, action: () => Promise<unknown>, fallback: string) {
    setBusy(next);
    setError(null);
    try {
      await action();
      setStatus(await getSleeperConnection());
    } catch (err) {
      setError(err instanceof Error ? err.message : fallback);
    } finally {
      setBusy(null);
    }
  }

  if (status === null) return error ? <p className="text-sm text-red-500">{error}</p> : null;

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">Sleeper</h2>
        <p className="text-sm text-black/50 dark:text-white/50">Paste your Sleeper league&apos;s link. No sign-in needed.</p>
      </div>
      {status.connected ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1 text-sm">
            <span className="text-black/70 dark:text-white/70">
              Connected to <span className="font-medium">{status.league_name ?? `Sleeper league ${status.sleeper_league_id}`}</span>
            </span>
            <span className="text-black/50 dark:text-white/50">
              {status.last_synced_at ? `Last synced ${new Date(status.last_synced_at).toLocaleString()}` : "Never synced yet"}
            </span>
            {status.last_sync_error && <span className="text-red-500">Last sync failed: {status.last_sync_error}</span>}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => run("syncing", syncSleeperNow, "Sync failed.")}
              disabled={busy !== null}
              className="w-fit rounded-full bg-[var(--wl-accent)] px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
            >
              {busy === "syncing" ? "Syncing…" : "Sync now"}
            </button>
            <button
              onClick={() => run("disconnecting", disconnectSleeper, "Couldn't disconnect.")}
              disabled={busy !== null}
              className="w-fit rounded-full border border-black/10 px-4 py-2 text-sm font-medium text-black/70 disabled:opacity-40 dark:border-white/10 dark:text-white/70"
            >
              {busy === "disconnecting" ? "Disconnecting…" : "Disconnect"}
            </button>
          </div>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!link.trim()) return setError("Paste your league's Sleeper link.");
            void run("connecting", () => connectSleeper(link.trim()), "Couldn't connect that Sleeper league.");
          }}
          className="flex flex-col gap-3"
        >
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-black/70 dark:text-white/70">Your Sleeper username</span>
            <span className="text-xs text-black/45 dark:text-white/45">We&apos;ll find your leagues. No sign-in or link needed.</span>
            <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="your username" className={FIELD_CLASS} />
          </label>
          <button
            type="button"
            disabled={!username.trim() || busy !== null}
            onClick={() =>
              void run("connecting", async () => setOptions((await getSleeperLeagues(username.trim())).leagues), "No Sleeper user by that name.")
            }
            className="w-fit rounded-full border border-black/10 px-4 py-2 text-sm font-medium disabled:opacity-40 dark:border-white/10"
          >
            Find my leagues
          </button>
          {options?.length === 0 && <span className="text-xs text-black/55 dark:text-white/55">No leagues on that account this season.</span>}
          {options?.map((lg) => (
            <button
              key={lg.league_id}
              type="button"
              disabled={busy !== null}
              onClick={() => void run("connecting", () => connectSleeper(lg.league_id), "Couldn't connect that Sleeper league.")}
              className="w-fit rounded-full bg-[var(--wl-accent)] px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
            >
              Connect {lg.name}
              {lg.teams ? ` · ${lg.teams} teams` : ""}
            </button>
          ))}
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-black/70 dark:text-white/70">Or your league&apos;s Sleeper link</span>
            <span className="text-xs text-black/45 dark:text-white/45">
              Open your league at sleeper.com and copy the address (sleeper.com/leagues/…), or paste just the league ID.
            </span>
            <input type="text" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://sleeper.com/leagues/…" className={FIELD_CLASS} />
          </label>
          <button
            type="submit"
            disabled={busy !== null}
            className="w-fit rounded-full bg-[var(--wl-accent)] px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
          >
            {busy === "connecting" ? "Connecting…" : "Connect Sleeper league"}
          </button>
        </form>
      )}
      {error && <p className="text-sm text-red-500">{error}</p>}
    </section>
  );
}
