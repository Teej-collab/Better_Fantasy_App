import Link from "next/link";
import type { AdminLeagueDetail as AdminLeagueDetailData } from "@/lib/api";
import { relativeTime } from "@/lib/adminFormat";

export function AdminLeagueDetail({ league }: { league: AdminLeagueDetailData }) {
  return (
    <div className="flex flex-col gap-4">
      <Link href="/admin/leagues" className="text-xs text-[var(--admin-accent)] hover:underline">
        ← All Leagues
      </Link>

      <div>
        <h2 className="text-xl font-semibold">{league.name}</h2>
        <p className="text-sm text-black/50 dark:text-white/50">
          Created {relativeTime(league.created_at)} · Invite code {league.invite_code}
        </p>
      </div>

      <section className="neon-panel flex flex-col gap-2 rounded-xl bg-black/[0.015] p-4 dark:bg-white/[0.03]">
        <h3 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
          Members ({league.members.length})
        </h3>
        <ul className="flex flex-col divide-y divide-black/5 dark:divide-white/5">
          {league.members.map((m) => (
            <li key={m.user_id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div className="flex min-w-0 flex-col">
                <Link
                  href={m.owner_id ? `/admin/users/${m.user_id}` : "#"}
                  className={`truncate font-medium ${m.owner_id ? "hover:underline" : ""}`}
                >
                  {m.display_name}
                  {m.role === "commissioner" && (
                    <span className="ml-1.5 rounded-full bg-[color-mix(in_srgb,var(--admin-accent)_15%,transparent)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--admin-accent)]">
                      Commissioner
                    </span>
                  )}
                </Link>
                <span className="truncate text-xs text-black/50 dark:text-white/50">
                  {m.team_name ?? "No team yet"}
                </span>
              </div>
              <div className="shrink-0 text-right text-xs text-black/50 dark:text-white/50">
                <div>{m.last_active ? `Active ${relativeTime(m.last_active)}` : "Never active"}</div>
                <div>{m.recent_events} events (7d)</div>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
