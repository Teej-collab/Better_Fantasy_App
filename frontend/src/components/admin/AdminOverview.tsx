"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  getAdminOverview,
  getOnlineOwners,
  type AdminOverview as AdminOverviewData,
  type NavigationHeatmap,
  type OnlineOwner,
} from "@/lib/api";
import { eventLabel } from "@/lib/analyticsEvents";
import { KpiCard } from "@/components/admin/KpiCard";

const ONLINE_POLL_INTERVAL_MS = 20 * 1000;
const OVERVIEW_POLL_INTERVAL_MS = 60 * 1000;

function sinceLabel(iso: string | null): string {
  if (!iso) return "Collection hasn't started yet";
  const date = new Date(iso);
  return `Tracking since ${date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
}

export function AdminOverview({
  initialOverview,
  initialHeatmap,
  initialOnline,
}: {
  initialOverview: AdminOverviewData;
  initialHeatmap: NavigationHeatmap;
  initialOnline: OnlineOwner[];
}) {
  const [overview, setOverview] = useState(initialOverview);
  const [online, setOnline] = useState(initialOnline);

  useEffect(() => {
    const onlineId = setInterval(() => {
      getOnlineOwners()
        .then((d) => setOnline(d.owners))
        .catch(() => {});
    }, ONLINE_POLL_INTERVAL_MS);
    const overviewId = setInterval(() => {
      getAdminOverview(overview.window_days)
        .then(setOverview)
        .catch(() => {});
    }, OVERVIEW_POLL_INTERVAL_MS);
    return () => {
      clearInterval(onlineId);
      clearInterval(overviewId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const topRoutes = initialHeatmap.routes.slice(0, 5);
  const maxViews = topRoutes[0]?.views ?? 1;

  return (
    <div className="flex flex-col gap-6">
      <p className="text-xs text-black/50 dark:text-white/50">{sinceLabel(overview.tracking_started_at)}</p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <KpiCard label="Total Users" value={overview.total_users} />
        <KpiCard label={`Active (${overview.window_days}d)`} value={overview.active_users} />
        <KpiCard label={`New (${overview.window_days}d)`} value={overview.new_users} />
        <KpiCard label={`Active Leagues (${overview.window_days}d)`} value={overview.active_leagues} />
        <KpiCard label="Online Now" value={overview.online_now} live />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="neon-panel flex flex-col gap-2 rounded-xl bg-black/[0.015] p-4 dark:bg-white/[0.03]">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
              Top Pages (7d)
            </h2>
            <Link href="/admin/navigation" className="text-xs text-[var(--admin-accent)] hover:underline">
              Full navigation →
            </Link>
          </div>
          {topRoutes.length === 0 ? (
            <p className="text-sm text-black/50 dark:text-white/50">No page views yet.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {topRoutes.map((r) => (
                <div key={r.event_name} className="flex items-center gap-2">
                  <span className="w-28 shrink-0 truncate text-sm">{eventLabel(r.event_name)}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
                    <div
                      className="h-full rounded-full bg-[var(--admin-accent)]"
                      style={{ width: `${Math.max(4, (r.views / maxViews) * 100)}%` }}
                    />
                  </div>
                  <span className="w-10 shrink-0 text-right text-xs tabular-nums text-black/50 dark:text-white/50">
                    {r.views}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="neon-panel flex flex-col gap-2 rounded-xl bg-black/[0.015] p-4 dark:bg-white/[0.03]">
          <h2 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
            Online Now ({online.length})
          </h2>
          {online.length === 0 ? (
            <p className="text-sm text-black/50 dark:text-white/50">Nobody&apos;s in the app right now.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-black/5 dark:divide-white/5">
              {online.map((o) => (
                <li key={o.owner_id} className="flex items-center gap-2 py-1.5 text-sm">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden />
                  {o.display_name}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="neon-panel flex flex-col gap-2 rounded-xl bg-black/[0.015] p-4 text-xs text-black/50 dark:bg-white/[0.03] dark:text-white/50">
        <p>
          <strong className="text-black/70 dark:text-white/70">Not built yet:</strong> DAU/WAU/MAU trends and
          retention need weeks of accumulated data to mean anything; error monitoring, security monitoring, and the
          admin audit log each need their own logging pipeline, none of which exist yet. All real, planned next
          phases — see ADMIN_DASHBOARD.md.
        </p>
      </section>
    </div>
  );
}
