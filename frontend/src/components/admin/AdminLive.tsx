"use client";

import { useEffect, useState } from "react";
import { getAdminLive, type AdminLive as AdminLiveData } from "@/lib/api";
import { eventLabel } from "@/lib/analyticsEvents";
import { AdminSection, EmptyNote, Pill, StatTile, platformLabel, timeAgo } from "@/components/admin/AdminUi";

const POLL_MS = 10 * 1000;

// Who's in the app right now and what they're looking at, plus a
// running feed of every page view and tracked action as it happens.
// Refreshes every 10 seconds while this page is visible.
export function AdminLive({ initial }: { initial: AdminLiveData }) {
  const [data, setData] = useState(initial);
  const [, setTick] = useState(0);

  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null;
    function load() {
      getAdminLive()
        .then(setData)
        .catch(() => {});
      setTick((t) => t + 1);
    }
    function startOrStop() {
      if (document.visibilityState === "visible") {
        if (id === null) {
          load();
          id = setInterval(load, POLL_MS);
        }
      } else if (id !== null) {
        clearInterval(id);
        id = null;
      }
    }
    startOrStop();
    document.addEventListener("visibilitychange", startOrStop);
    return () => {
      document.removeEventListener("visibilitychange", startOrStop);
      if (id !== null) clearInterval(id);
    };
  }, []);

  const inAppNow = data.people.filter((p) => p.connected).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile label="In the app now" value={inAppNow} live />
        <StatTile label="People, last hour" value={data.last_hour.owners} />
        <StatTile label="Events, last hour" value={data.last_hour.events} />
      </div>

      <AdminSection
        title="Right Now"
        hint="Everyone with the app open, plus anyone who opened a page in the last 5 minutes."
      >
        {data.people.length === 0 ? (
          <EmptyNote>Nobody&apos;s in the app right now.</EmptyNote>
        ) : (
          <ul className="flex flex-col divide-y divide-black/5 dark:divide-white/5">
            {data.people.map((p) => (
              <li key={p.owner_id} className="flex items-center gap-3 py-2 text-sm">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${p.connected ? "bg-emerald-500" : "bg-black/20 dark:bg-white/25"}`}
                  aria-label={p.connected ? "App open" : "Recently active"}
                />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{p.display_name}</span>
                  <span className="block text-xs text-black/50 dark:text-white/50">
                    {p.event_name ? eventLabel(p.event_name) : "Unknown page"}
                    {p.route && <span className="font-mono"> · {p.route}</span>}
                  </span>
                </span>
                <span className="shrink-0 text-right text-xs text-black/50 dark:text-white/50">
                  {p.platform && <span className="block">{platformLabel(p.platform)}</span>}
                  {timeAgo(p.last_seen)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </AdminSection>

      <AdminSection title="Activity Feed" hint="The latest 40 page views and tracked actions, across everyone.">
        {data.feed.length === 0 ? (
          <EmptyNote>No activity yet.</EmptyNote>
        ) : (
          <ul className="flex flex-col divide-y divide-black/5 dark:divide-white/5">
            {data.feed.map((e, i) => (
              <li key={`${e.created_at}-${i}`} className="flex items-center gap-3 py-1.5 text-sm">
                <span className="w-16 shrink-0 text-xs tabular-nums text-black/45 dark:text-white/45">
                  {timeAgo(e.created_at)}
                </span>
                <span className="min-w-0 flex-1 wrap-break-word">
                  <span className="font-medium">{e.display_name ?? "Someone"}</span>{" "}
                  <span className="text-black/60 dark:text-white/60">
                    {e.event_type === "page_view" ? "opened" : "did"} {eventLabel(e.event_name)}
                  </span>
                </span>
                {e.event_name === "app_crash" ? (
                  <Pill tone="bad">crash</Pill>
                ) : e.event_type === "feature" ? (
                  <Pill>action</Pill>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </AdminSection>
    </div>
  );
}
