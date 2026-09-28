"use client";

import { useState } from "react";
import { getCrashReports, type CrashReports } from "@/lib/api";

const WINDOW_OPTIONS = [7, 30, 90] as const;

function formatDuration(seconds: number | undefined): string {
  if (seconds === undefined) return "?";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// App crashes detected by lib/crashReporter.ts — a page that died while
// on screen (on iOS, almost always the WebView killed for memory),
// reported on the owner's next launch.
export function AdminCrashes({ initial }: { initial: CrashReports }) {
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(false);

  function changeWindow(days: number) {
    setLoading(true);
    getCrashReports(days)
      .then(setData)
      .finally(() => setLoading(false));
  }

  const sectionClass = "neon-panel flex flex-col gap-2 rounded-xl bg-black/[0.015] p-4 dark:bg-white/[0.03]";
  const headingClass = "text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50";
  const mutedClass = "text-xs tabular-nums text-black/50 dark:text-white/50";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-black/50 dark:text-white/50">
          {data.crashes} crashes · {data.affected_owners} people affected
        </p>
        <div className="flex gap-1">
          {WINDOW_OPTIONS.map((d) => (
            <button
              key={d}
              onClick={() => changeWindow(d)}
              disabled={loading}
              className={`rounded-full border px-2 py-0.5 text-xs font-medium disabled:opacity-50 ${
                data.window_days === d
                  ? "border-[var(--admin-accent)] bg-[color-mix(in_srgb,var(--admin-accent)_12%,transparent)] text-[var(--admin-accent)]"
                  : "border-black/10 text-black/50 dark:border-white/10 dark:text-white/50"
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      <p className="text-xs text-black/50 dark:text-white/50">
        A crash is a page that died while someone was looking at it — on iPhones, almost always the app being shut down
        for using too much memory. It&apos;s reported the next time that person opens the app.
      </p>

      {data.crashes === 0 ? (
        <section className={sectionClass}>
          <p className="text-sm text-black/50 dark:text-white/50">No crashes reported in this window.</p>
        </section>
      ) : (
        <>
          <section className={sectionClass}>
            <h2 className={headingClass}>By Page</h2>
            <ul className="flex flex-col divide-y divide-black/5 dark:divide-white/5">
              {data.by_route.map((r) => (
                <li key={r.route} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0 font-mono text-xs break-all">{r.route}</span>
                  <span className={`shrink-0 ${mutedClass}`}>
                    {r.crashes} · {r.affected_owners} people
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className={sectionClass}>
            <h2 className={headingClass}>By Device</h2>
            <p className={mutedClass}>Screen size and pixel ratio — 375x667@2 is an iPhone 6/7/8/SE.</p>
            <ul className="flex flex-col divide-y divide-black/5 dark:divide-white/5">
              {data.by_device.map((d) => (
                <li key={`${d.os}|${d.screen}`} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0">
                    {d.os} <span className="font-mono text-xs text-black/50 dark:text-white/50">{d.screen}</span>
                  </span>
                  <span className={`shrink-0 ${mutedClass}`}>
                    {d.crashes} · {d.affected_owners} people
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className={sectionClass}>
            <h2 className={headingClass}>Recent</h2>
            <ul className="flex flex-col divide-y divide-black/5 dark:divide-white/5">
              {data.recent.map((c, i) => (
                <li key={`${c.created_at}-${i}`} className="flex flex-col gap-0.5 py-2 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 font-medium wrap-break-word">{c.display_name ?? "Unknown"}</span>
                    <span className={`shrink-0 ${mutedClass}`}>{formatWhen(c.created_at)}</span>
                  </div>
                  <span className="font-mono text-xs break-all text-black/70 dark:text-white/70">
                    {c.metadata.trail || c.route || "unknown page"}
                  </span>
                  <span className={mutedClass}>
                    {c.metadata.os ?? "?"} · {c.metadata.screen ?? "?"} · {c.metadata.native ? "app" : "browser"} ·
                    open {formatDuration(c.metadata.uptime_s)} before crashing
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
