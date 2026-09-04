import Link from "next/link";
import type { AdminLeagueList } from "@/lib/api";
import { relativeTime } from "@/lib/adminFormat";

export function AdminLeagues({ data }: { data: AdminLeagueList }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-black/50 dark:text-white/50">
        Activity is approximated from each league&apos;s own members&apos; overall usage over the last{" "}
        {data.window_days} days — not exact per-event league attribution yet (see ADMIN_DASHBOARD.md).
      </p>

      <ul className="neon-panel flex flex-col divide-y divide-black/5 rounded-lg bg-black/[0.015] dark:divide-white/5 dark:bg-white/[0.03]">
        {data.leagues.length === 0 ? (
          <li className="p-4 text-sm text-black/50 dark:text-white/50">No leagues yet.</li>
        ) : (
          data.leagues.map((l) => (
            <li key={l.id}>
              <Link
                href={`/admin/leagues/${l.id}`}
                className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm transition-colors hover:bg-black/5 dark:hover:bg-white/5"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{l.name}</span>
                  <span className="text-xs text-black/50 dark:text-white/50">
                    {l.member_count} member{l.member_count === 1 ? "" : "s"} · created {relativeTime(l.created_at)}
                  </span>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                    l.recent_events > 0
                      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                      : "bg-black/5 text-black/50 dark:bg-white/10 dark:text-white/50"
                  }`}
                >
                  {l.recent_events > 0 ? `${l.recent_events} events` : "Quiet"}
                </span>
              </Link>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
