"use client";

import { useState } from "react";
import Link from "next/link";
import { getAdminAuditLog, type AdminAuditLog as AdminAuditLogData } from "@/lib/api";
import { AdminSection, EmptyNote, Pill, formatWhen } from "@/components/admin/AdminUi";

const PAGE_SIZE = 50;

// Admin > Audit Log — every successful change made through the admin
// dashboard or the admin tools (app/monitoring.py records them), newest
// first. Read-only, and nothing here can be edited or removed.
export function AdminAuditLog({ initial }: { initial: AdminAuditLogData }) {
  const [entries, setEntries] = useState(initial.entries);
  const [total, setTotal] = useState(initial.total);
  const [loading, setLoading] = useState(false);

  function loadMore() {
    setLoading(true);
    getAdminAuditLog(PAGE_SIZE, entries.length)
      .then((d) => {
        setEntries((prev) => [...prev, ...d.entries]);
        setTotal(d.total);
      })
      .finally(() => setLoading(false));
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-xs text-black/50 dark:text-white/50">
        {total.toLocaleString()} admin actions recorded — granting or revoking admin, deleting users or teams, syncs,
        lineup changes. Read-only.
      </p>

      <AdminSection title="Admin Actions">
        {entries.length === 0 ? (
          <EmptyNote>No admin actions recorded yet. They&apos;ll show up here as they happen.</EmptyNote>
        ) : (
          <ul className="flex flex-col divide-y divide-black/5 dark:divide-white/5">
            {entries.map((e) => (
              <li key={e.id} className="flex flex-col gap-0.5 py-2 text-sm">
                <span className="flex items-center justify-between gap-3">
                  <span className="min-w-0 font-medium wrap-break-word">{e.action}</span>
                  <span className="shrink-0 text-xs text-black/50 dark:text-white/50">{formatWhen(e.created_at)}</span>
                </span>
                <span className="flex flex-wrap items-center gap-x-2 text-xs text-black/50 dark:text-white/50">
                  <span>
                    by{" "}
                    {e.actor_user_id ? (
                      <Link href={`/admin/users/${e.actor_user_id}`} className="text-[var(--admin-accent)] hover:underline">
                        {e.actor ?? `user ${e.actor_user_id}`}
                      </Link>
                    ) : (
                      "unknown"
                    )}
                  </span>
                  {e.target && <span>· {e.target}</span>}
                  <Pill>{e.method}</Pill>
                  <span className="font-mono break-all">{e.path}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        {entries.length < total && (
          <button
            onClick={loadMore}
            disabled={loading}
            className="self-center rounded-full border border-black/10 px-3 py-1 text-xs font-medium disabled:opacity-50 dark:border-white/10"
          >
            {loading ? "Loading…" : "Load more"}
          </button>
        )}
      </AdminSection>
    </div>
  );
}
