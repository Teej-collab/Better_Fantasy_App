import Link from "next/link";
import type { AdminTaps as AdminTapsData } from "@/lib/api";
import { AdminSection, BarRow, EmptyNote, StatTile, timeAgo } from "@/components/admin/AdminUi";
import { screenLabel, tapLabel } from "@/lib/tapLabels";

// Admin > Taps (2026-10-22): what members tap and change, and who.
// "Most tapped" ranks every tap (named taps plus every change made in
// the app); open a row to see who. "Who uses what" shows each person's
// most used taps and screens. Same as the app's admin/taps.tsx.
export function AdminTaps({ data, windows }: { data: AdminTapsData; windows: number[] }) {
  const max = Math.max(1, ...data.targets.map((t) => t.taps));
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-black/50 dark:text-white/50">
          Taps and changes in the app over the last {data.window_days} days. They started counting on Oct 22, 2026.
        </p>
        <nav className="flex shrink-0 gap-1" aria-label="Time window">
          {windows.map((d) => (
            <Link
              key={d}
              href={`/admin/taps?days=${d}`}
              aria-current={d === data.window_days ? "page" : undefined}
              className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
                d === data.window_days
                  ? "border-[var(--admin-accent)] bg-[color-mix(in_srgb,var(--admin-accent)_12%,transparent)] text-[var(--admin-accent)]"
                  : "border-black/10 text-black/50 dark:border-white/10 dark:text-white/50"
              }`}
            >
              {d}d
            </Link>
          ))}
        </nav>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatTile label="Taps" value={data.total_taps.toLocaleString()} />
        <StatTile label="Different taps" value={data.targets.length} />
        <StatTile label="People" value={data.people.filter((p) => p.taps > 0).length} hint="tapped something" />
      </div>

      <AdminSection title="Most tapped" hint="Open a row to see who. “Did:” rows are changes made in the app, like a claim or a bet.">
        {data.targets.length === 0 ? (
          <EmptyNote>No taps yet in this window.</EmptyNote>
        ) : (
          <ul className="flex flex-col divide-y divide-black/5 dark:divide-white/5">
            {data.targets.map((t) => (
              <li key={t.target}>
                <details className="py-1.5">
                  <summary className="cursor-pointer list-none">
                    <BarRow
                      label={tapLabel(t.target)}
                      value={t.taps}
                      max={max}
                      right={`${t.taps} · ${t.unique_people} ${t.unique_people === 1 ? "person" : "people"}`}
                    />
                  </summary>
                  <ul className="mt-1 flex flex-col gap-0.5 pl-2">
                    {t.people.map((p) => (
                      <li key={p.owner_id} className="flex justify-between gap-3 text-xs text-black/60 dark:text-white/60">
                        <span>{p.display_name}</span>
                        <span>
                          {p.taps}× · last {timeAgo(p.last_at)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            ))}
          </ul>
        )}
      </AdminSection>

      <AdminSection title="Who uses what" hint="Each person's most used taps and screens in this window.">
        {data.people.length === 0 ? (
          <EmptyNote>Nobody has used the app in this window.</EmptyNote>
        ) : (
          <ul className="flex flex-col divide-y divide-black/5 dark:divide-white/5">
            {data.people.map((p) => (
              <li key={p.owner_id} className="flex flex-col gap-1 py-2">
                <div className="flex justify-between gap-3">
                  <span className="text-sm font-medium">{p.display_name}</span>
                  <span className="text-xs text-black/50 dark:text-white/50">
                    {p.taps} taps · {p.views} screens
                  </span>
                </div>
                {p.top_taps.length > 0 && (
                  <p className="text-xs text-black/60 dark:text-white/60">
                    Taps: {p.top_taps.slice(0, 5).map((t) => `${tapLabel(t.target)} (${t.taps})`).join(", ")}
                  </p>
                )}
                {p.top_screens.length > 0 && (
                  <p className="text-xs text-black/45 dark:text-white/45">
                    Screens: {p.top_screens.slice(0, 5).map((v) => `${screenLabel(v.screen)} (${v.views})`).join(", ")}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </AdminSection>
    </div>
  );
}
