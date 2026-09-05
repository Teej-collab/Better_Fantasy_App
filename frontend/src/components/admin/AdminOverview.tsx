"use client";

import { useEffect, useState } from "react";
import {
  getAdminActivity,
  getAdminAlerts,
  getAdminOverview,
  getAdminSystemHealth,
  getAdminTimeseries,
  getOnlineOwners,
  type AdminActivity,
  type AdminAlerts,
  type AdminOverview as AdminOverviewData,
  type AdminSystemHealth,
  type AdminTimeseries,
  type FeatureUsage,
  type OnlineOwner,
} from "@/lib/api";
import { eventLabel } from "@/lib/analyticsEvents";
import { KpiCard } from "@/components/admin/KpiCard";
import { LineChart } from "@/components/admin/LineChart";
import { DonutChart } from "@/components/admin/DonutChart";

const ONLINE_POLL_INTERVAL_MS = 20 * 1000;
const OVERVIEW_POLL_INTERVAL_MS = 60 * 1000;

function sinceLabel(iso: string | null): string {
  if (!iso) return "Collection hasn't started yet";
  const date = new Date(iso);
  return `Tracking since ${date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
}

function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function timeAgo(iso: string | null): string {
  if (!iso) return "Never run";
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

const JOB_LABELS: Record<string, string> = {
  full_sync: "Full ESPN Sync",
  live_sync: "Live Sync",
  sleeper_player_sync: "Player Database Sync",
  projected_points_sync: "Projected Points Sync",
  weekly_compute: "Weekly Scoring Compute",
};

const ACTIVITY_LABELS: Record<string, string> = {
  signup: "New signup",
  league_created: "League created",
  feedback: "Feedback submitted",
};

export function AdminOverview({
  initialOverview,
  initialTimeseries,
  initialFeatures,
  initialActivity,
  initialAlerts,
  initialHealth,
  initialOnline,
}: {
  initialOverview: AdminOverviewData;
  initialTimeseries: AdminTimeseries;
  initialFeatures: FeatureUsage;
  initialActivity: AdminActivity;
  initialAlerts: AdminAlerts;
  initialHealth: AdminSystemHealth;
  initialOnline: OnlineOwner[];
}) {
  const [overview, setOverview] = useState(initialOverview);
  const [timeseries, setTimeseries] = useState(initialTimeseries);
  const [activity, setActivity] = useState(initialActivity);
  const [alerts, setAlerts] = useState(initialAlerts);
  const [health, setHealth] = useState(initialHealth);
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
      getAdminTimeseries(timeseries.window_days)
        .then(setTimeseries)
        .catch(() => {});
      getAdminActivity()
        .then(setActivity)
        .catch(() => {});
      getAdminAlerts()
        .then(setAlerts)
        .catch(() => {});
      getAdminSystemHealth()
        .then(setHealth)
        .catch(() => {});
    }, OVERVIEW_POLL_INTERVAL_MS);
    return () => {
      clearInterval(onlineId);
      clearInterval(overviewId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const labels = timeseries.days.map((d) => dayLabel(d.day));
  const donutSlices = initialFeatures.features
    .slice(0, 6)
    .map((f) => ({ label: eventLabel(f.event_name), value: f.uses }));

  return (
    <div className="flex flex-col gap-6">
      <p className="text-xs text-black/50 dark:text-white/50">{sinceLabel(overview.tracking_started_at)}</p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard label="Total Users" value={overview.total_users} />
        <KpiCard label={`New (${overview.window_days}d)`} value={overview.new_users} />
        <KpiCard label={`Active (${overview.window_days}d)`} value={overview.active_users} />
        <KpiCard label="Total Leagues" value={overview.total_leagues} />
        <KpiCard label={`Active Leagues (${overview.window_days}d)`} value={overview.active_leagues} />
        <KpiCard label="Online Now" value={overview.online_now} live />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="neon-panel flex flex-col gap-3 rounded-xl bg-black/[0.015] p-4 lg:col-span-2 dark:bg-white/[0.03]">
          <h2 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
            Activity Over Time ({timeseries.window_days}d)
          </h2>
          <LineChart
            labels={labels}
            series={[
              { label: "Events", color: "#39ff14", values: timeseries.days.map((d) => d.events) },
              { label: "Active users", color: "#22d3ee", values: timeseries.days.map((d) => d.active_owners) },
              { label: "Signups", color: "#f59e0b", values: timeseries.days.map((d) => d.signups) },
            ]}
          />
          <p className="text-[11px] text-black/40 dark:text-white/40">
            Real data — genuinely sparse this early on. Fills in as usage accumulates.
          </p>
        </section>

        <section className="neon-panel flex flex-col gap-2 rounded-xl bg-black/[0.015] p-4 dark:bg-white/[0.03]">
          <h2 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
            Feature Usage (30d)
          </h2>
          <DonutChart slices={donutSlices} centerLabel={`${initialFeatures.features.reduce((s, f) => s + f.uses, 0)} uses`} />
        </section>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="neon-panel flex flex-col gap-2 rounded-xl bg-black/[0.015] p-4 dark:bg-white/[0.03]">
          <h2 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
            Recent Activity
          </h2>
          {activity.activity.length === 0 ? (
            <p className="text-sm text-black/50 dark:text-white/50">Nothing yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-black/5 dark:divide-white/5">
              {activity.activity.map((item, i) => (
                <li key={i} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                  <span className="min-w-0 truncate">
                    <span className="text-black/50 dark:text-white/50">{ACTIVITY_LABELS[item.kind]}:</span>{" "}
                    {item.label}
                  </span>
                  <span className="shrink-0 text-xs text-black/40 dark:text-white/40">{timeAgo(item.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="neon-panel flex flex-col gap-2 rounded-xl bg-black/[0.015] p-4 dark:bg-white/[0.03]">
          <h2 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
            System Health
          </h2>
          <div className="flex flex-col gap-1.5 text-sm">
            <div className="flex items-center justify-between">
              <span>Database</span>
              <span className={`flex items-center gap-1.5 text-xs ${health.db.reachable ? "text-emerald-500" : "text-red-500"}`}>
                <span className={`h-2 w-2 rounded-full ${health.db.reachable ? "bg-emerald-500" : "bg-red-500"}`} aria-hidden />
                {health.db.reachable ? "Healthy" : "Unreachable"}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs text-black/50 dark:text-white/50">
              <span>Connection pool</span>
              <span className="tabular-nums">
                {health.db.pool_size - health.db.pool_idle}/{health.db.pool_max} in use
              </span>
            </div>
            <div className="flex items-center justify-between text-xs text-black/50 dark:text-white/50">
              <span>Live connections</span>
              <span className="tabular-nums">
                {health.websocket_connections.chat + health.websocket_connections.draft + health.websocket_connections.gamecast} (
                {health.websocket_connections.chat} chat, {health.websocket_connections.draft} draft,{" "}
                {health.websocket_connections.gamecast} gamecast)
              </span>
            </div>
            <div className="flex items-center justify-between text-xs text-black/50 dark:text-white/50">
              <span>Backend uptime</span>
              <span className="tabular-nums">
                {health.uptime_seconds < 3600
                  ? `${Math.round(health.uptime_seconds / 60)}m`
                  : `${Math.round(health.uptime_seconds / 3600)}h`}
              </span>
            </div>
          </div>
          <div className="mt-1 h-px bg-black/5 dark:bg-white/5" />
          {Object.entries(JOB_LABELS).map(([name, label]) => (
            <div key={name} className="flex items-center justify-between text-xs">
              <span className="text-black/50 dark:text-white/50">{label}</span>
              <span className="tabular-nums">{timeAgo(health.jobs[name] ?? null)}</span>
            </div>
          ))}
          {online.length > 0 && (
            <>
              <div className="mt-1 h-px bg-black/5 dark:bg-white/5" />
              <span className="text-xs text-black/50 dark:text-white/50">Online now ({online.length})</span>
              <ul className="flex flex-col gap-1">
                {online.map((o) => (
                  <li key={o.owner_id} className="flex items-center gap-2 text-sm">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden />
                    {o.display_name}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="neon-panel flex flex-col gap-2 rounded-xl bg-black/[0.015] p-4 dark:bg-white/[0.03]">
          <h2 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">Alerts</h2>
          {alerts.alerts.length === 0 ? (
            <p className="text-sm text-black/50 dark:text-white/50">Nothing needs your attention.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-black/5 dark:divide-white/5">
              {alerts.alerts.map((a, i) => (
                <li key={i} className="flex items-start gap-2 py-1.5 text-sm">
                  <span aria-hidden>{a.severity === "warning" ? "⚠️" : "ℹ️"}</span>
                  <span>{a.message}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="neon-panel flex flex-col gap-2 rounded-xl bg-black/[0.015] p-4 text-xs text-black/50 dark:bg-white/[0.03] dark:text-white/50">
        <p>
          <strong className="text-black/70 dark:text-white/70">Not built yet:</strong> retention (Day 1/7/30) needs
          cohorts of users who signed up weeks ago; error monitoring, security monitoring, and the admin audit log
          each need their own logging pipeline, none of which exist yet. All real, planned next phases — see
          ADMIN_DASHBOARD.md.
        </p>
      </section>
    </div>
  );
}
