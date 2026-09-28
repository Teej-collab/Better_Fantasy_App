"use client";

import { useState } from "react";
import {
  getAdminPaths,
  getFeatureUsage,
  getNavigationHeatmap,
  type AdminPaths,
  type FeatureUsage,
  type NavigationHeatmap,
} from "@/lib/api";
import { eventLabel } from "@/lib/analyticsEvents";
import { AdminSection, BarRow, EmptyNote } from "@/components/admin/AdminUi";

const WINDOW_OPTIONS = [7, 30, 90] as const;

// Visual intensity, not just bar length — a route at 100% of the max
// gets the full accent glow, tapering down for everything else, so
// the busiest routes are legible at a glance the way a real heat map
// reads (spec's own "use visual intensity to communicate usage").
function intensity(views: number, max: number): number {
  return max === 0 ? 0 : Math.max(0.15, views / max);
}

export function AdminNavigationHeatmap({
  initialHeatmap,
  initialFeatures,
  initialPaths,
}: {
  initialHeatmap: NavigationHeatmap;
  initialFeatures: FeatureUsage;
  initialPaths: AdminPaths;
}) {
  const [heatmap, setHeatmap] = useState(initialHeatmap);
  const [features, setFeatures] = useState(initialFeatures);
  const [paths, setPaths] = useState(initialPaths);
  const [loading, setLoading] = useState(false);

  function changeWindow(days: number) {
    setLoading(true);
    Promise.all([getNavigationHeatmap(days), getFeatureUsage(days), getAdminPaths(days)])
      .then(([h, f, p]) => {
        setHeatmap(h);
        setFeatures(f);
        setPaths(p);
      })
      .finally(() => setLoading(false));
  }

  const maxViews = heatmap.routes[0]?.views ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <p className="text-xs text-black/50 dark:text-white/50">{heatmap.total_views} total page views</p>
        <div className="flex gap-1">
          {WINDOW_OPTIONS.map((d) => (
            <button
              key={d}
              onClick={() => changeWindow(d)}
              disabled={loading}
              className={`rounded-full border px-2 py-0.5 text-xs font-medium disabled:opacity-50 ${
                heatmap.window_days === d
                  ? "border-[var(--admin-accent)] bg-[color-mix(in_srgb,var(--admin-accent)_12%,transparent)] text-[var(--admin-accent)]"
                  : "border-black/10 text-black/50 dark:border-white/10 dark:text-white/50"
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      <section className="neon-panel flex flex-col gap-2 rounded-xl bg-black/[0.015] p-4 dark:bg-white/[0.03]">
        <h2 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
          Page Heat Map
        </h2>
        {heatmap.routes.length === 0 ? (
          <p className="text-sm text-black/50 dark:text-white/50">No page views recorded in this window yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {heatmap.routes.map((r) => {
              const alpha = intensity(r.views, maxViews);
              return (
                <div key={r.event_name} className="flex items-center gap-2">
                  <span className="w-32 shrink-0 min-w-0 wrap-break-word text-sm">{eventLabel(r.event_name)}</span>
                  <div className="h-3 flex-1 overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(3, (r.views / maxViews) * 100)}%`,
                        backgroundColor: `color-mix(in srgb, var(--admin-accent) ${Math.round(alpha * 100)}%, transparent)`,
                        boxShadow: alpha > 0.6 ? "0 0 8px var(--admin-accent)" : undefined,
                      }}
                    />
                  </div>
                  <span className="w-32 shrink-0 text-right text-xs tabular-nums text-black/50 dark:text-white/50">
                    {r.views} views · {r.unique_owners} people
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <AdminSection title="Where People Go Next" hint="The most common page-to-page moves within a visit.">
        {paths.transitions.length === 0 ? (
          <EmptyNote>Not enough visits in this window yet.</EmptyNote>
        ) : (
          <div className="flex flex-col gap-2">
            {paths.transitions.slice(0, 20).map((t) => (
              <BarRow
                key={`${t.from_page}-${t.to_page}`}
                label={
                  <>
                    {eventLabel(t.from_page)} <span className="text-black/40 dark:text-white/40">→</span>{" "}
                    {eventLabel(t.to_page)}
                  </>
                }
                value={t.moves}
                max={paths.transitions[0].moves}
              />
            ))}
          </div>
        )}
      </AdminSection>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <AdminSection title="Where Visits Start">
          {paths.entries.length === 0 ? (
            <EmptyNote>No visits yet.</EmptyNote>
          ) : (
            <div className="flex flex-col gap-2">
              {paths.entries.map((e) => (
                <BarRow key={e.event_name} label={eventLabel(e.event_name)} value={e.sessions} max={paths.entries[0].sessions} />
              ))}
            </div>
          )}
        </AdminSection>
        <AdminSection title="Where Visits End" hint="Bounces are visits that only saw that one page.">
          {paths.exits.length === 0 ? (
            <EmptyNote>No visits yet.</EmptyNote>
          ) : (
            <div className="flex flex-col gap-2">
              {paths.exits.map((e) => (
                <BarRow
                  key={e.event_name}
                  label={eventLabel(e.event_name)}
                  value={e.sessions}
                  max={paths.exits[0].sessions}
                  right={`${e.sessions}${e.bounces ? ` · ${e.bounces} bounced` : ""}`}
                />
              ))}
            </div>
          )}
        </AdminSection>
      </div>

      <section className="neon-panel flex flex-col gap-2 rounded-xl bg-black/[0.015] p-4 dark:bg-white/[0.03]">
        <h2 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
          Feature Usage
        </h2>
        <p className="text-xs text-black/50 dark:text-white/50">
          A small, deliberately curated set — not every click (see ANALYTICS_EVENTS.md).
        </p>
        {features.features.length === 0 ? (
          <p className="text-sm text-black/50 dark:text-white/50">No feature events recorded in this window yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-black/5 dark:divide-white/5">
            {features.features.map((f) => (
              <li key={f.event_name} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span>{eventLabel(f.event_name)}</span>
                <span className="text-xs tabular-nums text-black/50 dark:text-white/50">
                  {f.uses} uses · {f.unique_owners} people
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
