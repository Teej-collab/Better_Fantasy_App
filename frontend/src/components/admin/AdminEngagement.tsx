"use client";

import { useState } from "react";
import { getAdminEngagement, type AdminEngagement as AdminEngagementData } from "@/lib/api";
import { LineChart } from "@/components/admin/LineChart";
import {
  AdminSection,
  BarRow,
  EmptyNote,
  StatTile,
  WindowPicker,
  dayLabel,
  formatDuration,
  pct,
  platformLabel,
} from "@/components/admin/AdminUi";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOUR_LABELS: Record<number, string> = { 0: "12a", 6: "6a", 12: "12p", 18: "6p" };

function rateTone(rate: number | null): "good" | "warn" | "bad" | "default" {
  if (rate === null) return "default";
  if (rate >= 0.6) return "good";
  if (rate >= 0.3) return "warn";
  return "bad";
}

export function AdminEngagement({ initial }: { initial: AdminEngagementData }) {
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(false);

  function changeWindow(days: number) {
    setLoading(true);
    getAdminEngagement(days)
      .then(setData)
      .finally(() => setLoading(false));
  }

  const s = data.summary;
  const heat = new Map(data.when_active.map((c) => [`${c.dow}-${c.hour}`, c.events]));
  const heatMax = Math.max(1, ...data.when_active.map((c) => c.events));
  const platformMax = Math.max(1, ...data.platforms.map((p) => p.owners));
  const funnelTop = data.funnel[0]?.count || 1;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-black/50 dark:text-white/50">
          People are counted per team; days run on Central time.
        </p>
        <WindowPicker value={data.window_days} onChange={changeWindow} disabled={loading} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Active today" value={s.dau} />
        <StatTile label="Active this week" value={s.wau} hint="last 7 days" />
        <StatTile label="Active this month" value={s.mau} hint="last 30 days" />
        <StatTile
          label="Stickiness"
          value={pct(s.stickiness)}
          hint={`avg ${s.avg_dau} a day of ${s.mau}`}
          tone={rateTone(s.stickiness)}
        />
        <StatTile label="Sessions" value={s.sessions.toLocaleString()} hint={`last ${data.window_days} days`} />
        <StatTile label="Pages / session" value={s.avg_pages_per_session} />
        <StatTile label="Typical session" value={formatDuration(s.median_session_seconds)} hint="median" />
      </div>

      <AdminSection
        title="Active People Over Time"
        hint="Daily, plus rolling 7-day and 30-day unique counts. Stickiness is the share of this month's people who show up on a typical day."
      >
        <LineChart
          labels={data.series.map((d) => dayLabel(d.day))}
          series={[
            { label: "Month", color: "#a78bfa", values: data.series.map((d) => d.mau) },
            { label: "Week", color: "#22d3ee", values: data.series.map((d) => d.wau) },
            { label: "Day", color: "#39ff14", values: data.series.map((d) => d.dau) },
          ]}
        />
      </AdminSection>

      <AdminSection title="When the League Is Active" hint="Page views by day and hour (Central). Brighter is busier.">
        {data.when_active.length === 0 ? (
          <EmptyNote>No page views in this window yet.</EmptyNote>
        ) : (
          <div className="flex flex-col gap-1 overflow-x-auto">
            {DAYS.map((day, dow) => (
              <div key={day} className="flex items-center gap-1">
                <span className="w-8 shrink-0 text-[10px] text-black/50 dark:text-white/50">{day}</span>
                <div className="grid flex-1 gap-px" style={{ gridTemplateColumns: "repeat(24, minmax(0, 1fr))" }}>
                  {Array.from({ length: 24 }, (_, hour) => {
                    const v = heat.get(`${dow}-${hour}`) ?? 0;
                    const alpha = v === 0 ? 0 : 0.12 + 0.88 * (v / heatMax);
                    return (
                      <div
                        key={hour}
                        title={`${day} ${hour}:00 — ${v} views`}
                        className="h-4 rounded-[2px] bg-black/5 dark:bg-white/5"
                        style={
                          v
                            ? { backgroundColor: `color-mix(in srgb, var(--admin-accent) ${Math.round(alpha * 100)}%, transparent)` }
                            : undefined
                        }
                      />
                    );
                  })}
                </div>
              </div>
            ))}
            <div className="flex gap-1">
              <span className="w-8 shrink-0" />
              <div className="grid flex-1" style={{ gridTemplateColumns: "repeat(24, minmax(0, 1fr))" }}>
                {Array.from({ length: 24 }, (_, hour) => (
                  <span key={hour} className="text-[9px] text-black/40 dark:text-white/40">
                    {HOUR_LABELS[hour] ?? ""}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </AdminSection>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <AdminSection title="Retention" hint="Of accounts old enough, the share still using the app after that many days.">
          <div className="grid grid-cols-3 gap-2">
            {data.retention.map((r) => (
              <div key={r.day} className="flex flex-col items-center gap-0.5 rounded-lg bg-black/[0.03] p-2 dark:bg-white/[0.04]">
                <span className="text-[10px] font-semibold text-black/50 uppercase dark:text-white/50">Day {r.day}</span>
                <span
                  className={`font-display text-xl font-semibold tabular-nums ${
                    { good: "text-emerald-500", warn: "text-amber-500", bad: "text-red-500", default: "" }[rateTone(r.rate)]
                  }`}
                >
                  {pct(r.rate)}
                </span>
                <span className="text-[10px] text-black/45 dark:text-white/45">
                  {r.retained}/{r.eligible} people
                </span>
              </div>
            ))}
          </div>
        </AdminSection>

        <AdminSection title="Signup Funnel" hint="All time — where people drop off between signing up and sticking around.">
          <div className="flex flex-col gap-2">
            {data.funnel.map((f, i) => {
              const prev = i > 0 ? data.funnel[i - 1].count : null;
              const drop = prev ? Math.round((1 - f.count / prev) * 100) : null;
              return (
                <BarRow
                  key={f.step}
                  label={f.label}
                  value={f.count}
                  max={funnelTop}
                  right={
                    <>
                      {f.count}
                      {drop !== null && drop > 0 && <span className="ml-1 text-red-500">−{drop}%</span>}
                    </>
                  }
                />
              );
            })}
          </div>
        </AdminSection>
      </div>

      <AdminSection
        title="Signup Cohorts"
        hint="Accounts grouped by the week they signed up, and the share active in each week after. Blank means that week hasn't happened yet."
      >
        {data.cohorts.length === 0 ? (
          <EmptyNote>No signups in the last 8 weeks.</EmptyNote>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] tracking-wide text-black/50 uppercase dark:text-white/50">
                  <th className="py-1 pr-3 font-semibold">Week of</th>
                  <th className="py-1 pr-3 font-semibold">People</th>
                  {[1, 2, 3, 4].map((w) => (
                    <th key={w} className="py-1 pr-1 text-center font-semibold">
                      Wk {w}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.cohorts.map((c) => (
                  <tr key={c.week} className="border-t border-black/5 dark:border-white/5">
                    <td className="py-1.5 pr-3 whitespace-nowrap">{dayLabel(c.week)}</td>
                    <td className="py-1.5 pr-3 tabular-nums">{c.size}</td>
                    {c.weeks.map((rate, i) => (
                      <td key={i} className="p-0.5">
                        <div
                          className="rounded py-1 text-center text-xs tabular-nums"
                          style={
                            rate === null
                              ? undefined
                              : {
                                  backgroundColor: `color-mix(in srgb, var(--admin-accent) ${Math.round(10 + rate * 60)}%, transparent)`,
                                }
                          }
                        >
                          {rate === null ? "" : pct(rate)}
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminSection>

      <AdminSection title="Devices" hint={`People and events by platform, last ${data.window_days} days.`}>
        {data.platforms.length === 0 ? (
          <EmptyNote>No activity in this window.</EmptyNote>
        ) : (
          <div className="flex flex-col gap-2">
            {data.platforms.map((p) => (
              <BarRow
                key={`${p.platform}-${p.device_type}`}
                label={platformLabel(p.platform, p.device_type)}
                value={p.owners}
                max={platformMax}
                right={`${p.owners} people · ${p.events.toLocaleString()} events`}
              />
            ))}
          </div>
        )}
      </AdminSection>
    </div>
  );
}
