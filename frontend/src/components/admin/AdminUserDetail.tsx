import Link from "next/link";
import type { AdminUserDetail as AdminUserDetailData } from "@/lib/api";
import { eventLabel } from "@/lib/analyticsEvents";
import { relativeTime } from "@/lib/adminFormat";

// Never renders password_hash, tokens, or push credentials — the
// backend's own query (app/queries/admin_users.py) never even selects
// them, so there's nothing here to accidentally leak; this component
// only ever has the fields listed in AdminUserDetail (lib/api.ts) to
// work with in the first place.
export function AdminUserDetail({ user }: { user: AdminUserDetailData }) {
  return (
    <div className="flex flex-col gap-4">
      <Link href="/admin/users" className="text-xs text-[var(--admin-accent)] hover:underline">
        ← All Users
      </Link>

      <div>
        <h2 className="flex items-center gap-2 text-xl font-semibold">
          {user.display_name}
          {user.is_commissioner_anywhere && (
            <span className="rounded-full bg-[color-mix(in_srgb,var(--admin-accent)_15%,transparent)] px-2 py-0.5 text-xs font-semibold text-[var(--admin-accent)]">
              Commissioner
            </span>
          )}
        </h2>
        <p className="text-sm text-black/50 dark:text-white/50">{user.email ?? "No email on file"}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Joined" value={relativeTime(user.created_at)} />
        <Stat label="Last Active" value={user.last_active ? relativeTime(user.last_active) : "Never"} />
        <Stat label="Leagues" value={String(user.league_count)} />
        <Stat label="User ID" value={String(user.user_id)} />
      </div>

      <section className="neon-panel flex flex-col gap-2 rounded-xl bg-black/[0.015] p-4 dark:bg-white/[0.03]">
        <h3 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">Leagues</h3>
        {user.leagues.length === 0 ? (
          <p className="text-sm text-black/50 dark:text-white/50">Not a member of any league.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-black/5 dark:divide-white/5">
            {user.leagues.map((l) => (
              <li key={l.league_id}>
                <Link
                  href={`/admin/leagues/${l.league_id}`}
                  className="flex items-center justify-between gap-3 py-2 text-sm hover:underline"
                >
                  <span>{l.league_name}</span>
                  <span className="text-xs text-black/50 capitalize dark:text-white/50">{l.role}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="neon-panel flex flex-col gap-2 rounded-xl bg-black/[0.015] p-4 dark:bg-white/[0.03]">
        <h3 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
          Recent Activity
        </h3>
        {user.recent_activity.length === 0 ? (
          <p className="text-sm text-black/50 dark:text-white/50">No recorded activity yet.</p>
        ) : (
          <ol className="flex flex-col divide-y divide-black/5 dark:divide-white/5">
            {user.recent_activity.map((event, i) => (
              <li key={i} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span>{eventLabel(event.event_name)}</span>
                <span className="shrink-0 text-xs tabular-nums text-black/50 dark:text-white/50">
                  {new Date(event.created_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="neon-panel flex flex-col gap-0.5 rounded-lg bg-black/[0.015] p-3 dark:bg-white/[0.03]">
      <span className="text-[10px] font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
        {label}
      </span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}
