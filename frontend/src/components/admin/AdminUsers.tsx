"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { listAdminUsers, type AdminUserList, type AdminUserStatus } from "@/lib/api";
import { relativeTime } from "@/lib/adminFormat";

const STATUS_TABS: { key: AdminUserStatus; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "inactive", label: "Inactive" },
  { key: "new", label: "New" },
  { key: "commissioner", label: "Commissioner" },
  { key: "multiple_leagues", label: "Multiple Leagues" },
  { key: "no_league", label: "No League" },
];

const SEARCH_DEBOUNCE_MS = 300;

export function AdminUsers({ initial }: { initial: AdminUserList }) {
  const [data, setData] = useState(initial);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<AdminUserStatus>("all");
  const [loading, setLoading] = useState(false);

  // Skips the redundant refetch on mount — `initial` already came
  // from the server with these exact default filters, same
  // skip-the-first-run guard PlayerSearchInput.tsx/DraftRoom.tsx use.
  const skipInitialFetch = useRef(true);

  useEffect(() => {
    if (skipInitialFetch.current) {
      skipInitialFetch.current = false;
      return;
    }
    setLoading(true);
    const id = setTimeout(() => {
      listAdminUsers(search, status)
        .then(setData)
        .finally(() => setLoading(false));
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [search, status]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, email, or user ID…"
          aria-label="Search users"
          className="w-full rounded-full border border-black/10 bg-transparent px-3 py-1.5 text-sm sm:max-w-xs dark:border-white/10"
        />
        <p className="shrink-0 text-xs text-black/50 dark:text-white/50">{data.total} total</p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {STATUS_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setStatus(t.key)}
            className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
              status === t.key
                ? "border-[var(--admin-accent)] bg-[color-mix(in_srgb,var(--admin-accent)_12%,transparent)] text-[var(--admin-accent)]"
                : "border-black/10 text-black/60 hover:bg-black/5 dark:border-white/10 dark:text-white/60 dark:hover:bg-white/5"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <ul
        className={`neon-panel flex flex-col divide-y divide-black/5 rounded-lg bg-black/[0.015] transition-opacity dark:divide-white/5 dark:bg-white/[0.03] ${loading ? "opacity-50" : ""}`}
      >
        {data.users.length === 0 ? (
          <li className="p-4 text-sm text-black/50 dark:text-white/50">No users match this filter.</li>
        ) : (
          data.users.map((u) => (
            <li key={u.user_id}>
              <Link
                href={`/admin/users/${u.user_id}`}
                className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm transition-colors hover:bg-black/5 dark:hover:bg-white/5"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="flex items-center gap-1.5 truncate font-medium">
                    {u.display_name}
                    {u.is_commissioner_anywhere && (
                      <span className="rounded-full bg-[color-mix(in_srgb,var(--admin-accent)_15%,transparent)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--admin-accent)]">
                        Commissioner
                      </span>
                    )}
                    {u.is_admin && (
                      <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                        Admin
                      </span>
                    )}
                  </span>
                  <span className="truncate text-xs text-black/50 dark:text-white/50">
                    {u.email ?? "No email"} · {u.league_count} league{u.league_count === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="shrink-0 text-right text-xs text-black/50 dark:text-white/50">
                  <div>Joined {relativeTime(u.created_at)}</div>
                  <div>{u.last_active ? `Active ${relativeTime(u.last_active)}` : "Never active"}</div>
                </div>
              </Link>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
