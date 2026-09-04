"use client";

import { useEffect, useState } from "react";
import {
  getOnlineOwners,
  getUsageSummary,
  type OnlineOwner,
  type UsageSummary,
} from "@/lib/api";

const ONLINE_POLL_INTERVAL_MS = 20 * 1000;
const WINDOW_OPTIONS = [7, 30, 90] as const;

export function AdminDashboard({
  initialOwners,
  initialUsage,
}: {
  initialOwners: OnlineOwner[];
  initialUsage: UsageSummary;
}) {
  const [owners, setOwners] = useState(initialOwners);
  const [usage, setUsage] = useState(initialUsage);
  const [days, setDays] = useState(initialUsage.window_days);
  const [loadingUsage, setLoadingUsage] = useState(false);

  // Live-ish without a dedicated WebSocket — chat's own presence
  // connection (already open app-wide via PresenceProvider) is the
  // real-time source of truth this reads from; polling this page
  // every 20s is simpler than a second live channel just for one
  // admin-only view. See app/chat/manager.py's connected_owner_ids.
  useEffect(() => {
    const id = setInterval(() => {
      getOnlineOwners().then(setOwners).catch(() => {});
    }, ONLINE_POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  function changeWindow(newDays: number) {
    setDays(newDays);
    setLoadingUsage(true);
    getUsageSummary(newDays)
      .then(setUsage)
      .finally(() => setLoadingUsage(false));
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
          Online now ({owners.length})
        </h2>
        {owners.length === 0 ? (
          <p className="text-sm text-black/50 dark:text-white/50">Nobody&apos;s in the app right now.</p>
        ) : (
          <ul className="neon-panel flex flex-col divide-y divide-black/5 rounded-lg bg-black/[0.015] dark:divide-white/5 dark:bg-white/[0.03]">
            {owners.map((o) => (
              <li key={o.owner_id} className="flex items-center gap-2 px-3 py-2 text-sm">
                <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden />
                {o.display_name}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
            Usage — last {usage.window_days} day{usage.window_days === 1 ? "" : "s"}
          </h2>
          <div className="flex gap-1">
            {WINDOW_OPTIONS.map((opt) => (
              <button
                key={opt}
                onClick={() => changeWindow(opt)}
                disabled={loadingUsage}
                className={`rounded-full border px-2 py-0.5 text-xs font-medium disabled:opacity-50 ${
                  days === opt
                    ? "border-[var(--wl-accent-dim)] bg-[var(--wl-accent-dim)]/10 text-[var(--wl-accent-dim)]"
                    : "border-black/10 text-black/50 dark:border-white/10 dark:text-white/50"
                }`}
              >
                {opt}d
              </button>
            ))}
          </div>
        </div>
        <p className="text-sm text-black/50 dark:text-white/50">{usage.total_views} total page views</p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <h3 className="text-xs font-medium text-black/50 dark:text-white/50">Top pages</h3>
            {usage.top_paths.length === 0 ? (
              <p className="text-sm text-black/50 dark:text-white/50">No views yet.</p>
            ) : (
              <ul className="neon-panel flex flex-col divide-y divide-black/5 rounded-lg bg-black/[0.015] dark:divide-white/5 dark:bg-white/[0.03]">
                {usage.top_paths.map((row) => (
                  <li key={row.path} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span className="truncate">{row.path}</span>
                    <span className="shrink-0 tabular-nums text-black/60 dark:text-white/60">
                      {row.views} · {row.unique_owners} people
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <h3 className="text-xs font-medium text-black/50 dark:text-white/50">By member</h3>
            {usage.by_owner.length === 0 ? (
              <p className="text-sm text-black/50 dark:text-white/50">No views yet.</p>
            ) : (
              <ul className="neon-panel flex flex-col divide-y divide-black/5 rounded-lg bg-black/[0.015] dark:divide-white/5 dark:bg-white/[0.03]">
                {usage.by_owner.map((row) => (
                  <li key={row.owner_id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span className="truncate">{row.display_name}</span>
                    <span className="shrink-0 tabular-nums text-black/60 dark:text-white/60">{row.views}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
