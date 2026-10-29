import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import {
  getAdminAiUsageServer,
  getAdminBadgesServer,
  getAdminInboxServer,
  getAdminOverviewServer,
  getAdminSystemHealthServer,
  getOnlineOwnersServer,
  listAdminLeaguesServer,
} from "@/lib/api";
import { InboxPanel } from "@/components/admin/AdminInbox";
import { AdminJobs } from "@/components/admin/AdminJobs";
import { needsMe } from "@/lib/adminFormat";

export const metadata: Metadata = { title: "Command Center — Admin — The Weekend" };

const SOURCE_LABEL = { espn: "ESPN", sleeper: "Sleeper", app: "In-app" } as const;

// Admin home on the web (2026-10-28, mockup D): the headline numbers,
// what needs a person (claimable, from the inbox), the server jobs with
// Run buttons, and every league at a glance. The old charts live on
// at /admin/charts.
export default async function CommandCenterPage() {
  const session = (await cookies()).get("session")?.value;
  const [overview, badges, inbox, health, online, leagues, ai] = await Promise.all([
    getAdminOverviewServer(session),
    getAdminBadgesServer(session),
    getAdminInboxServer(session),
    getAdminSystemHealthServer(session),
    getOnlineOwnersServer(session),
    listAdminLeaguesServer(session, 7),
    getAdminAiUsageServer(session, 30),
  ]);

  if (!overview || !inbox || !health) {
    return <p className="text-sm text-red-500">Couldn&apos;t load the Command Center — try refreshing.</p>;
  }

  const needs = needsMe(inbox).length;
  const healthy = badges ? badges.errors + badges.crashes === 0 : true;
  const onlineNames = (online ?? []).map((o) => o.display_name.split(" ")[0]);
  const kpis = [
    {
      label: "Online now",
      value: overview.online_now.toString(),
      sub: onlineNames.length ? onlineNames.slice(0, 4).join(", ") + (onlineNames.length > 4 ? "…" : "") : "Nobody right now",
      color: "#30d158",
    },
    { label: "Active 7d", value: overview.active_users.toString(), sub: `of ${overview.total_users} people` },
    {
      label: "Leagues",
      value: overview.total_leagues.toString(),
      sub: leagues
        ? `${leagues.leagues.filter((l) => l.source !== "app").length} synced · ${leagues.leagues.filter((l) => l.source === "app").length} in-app`
        : "",
    },
    {
      label: "Errors 24h",
      value: badges ? badges.errors.toString() : "–",
      sub: badges ? `${badges.crashes} ${badges.crashes === 1 ? "crash" : "crashes"}` : "",
      color: badges && badges.errors > 0 ? "#ff6961" : undefined,
    },
    {
      label: "AI · 30 days",
      value: ai ? `$${ai.total_cost.toFixed(2)}` : "–",
      sub: ai ? `${ai.calls} calls` : "",
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <h2 className="font-display text-2xl font-bold tracking-wide uppercase">Command Center</h2>
        <span className="flex items-center gap-1.5 text-sm text-black/50 dark:text-white/50">
          <span aria-hidden className={`h-2 w-2 rounded-full ${healthy && needs === 0 ? "bg-emerald-500" : "bg-amber-500"}`} />
          {needs > 0 ? `${needs} ${needs === 1 ? "thing needs" : "things need"} a person` : healthy ? "All systems normal" : "Some errors today"}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {kpis.map((k) => (
          <div key={k.label} className="flex flex-col gap-1 rounded-xl border border-black/10 p-3 dark:border-white/10 dark:bg-white/[0.03]">
            <span className="text-[10px] font-extrabold tracking-wider text-black/50 uppercase dark:text-white/50">{k.label}</span>
            <span className="font-display text-3xl font-semibold tabular-nums" style={k.color ? { color: k.color } : undefined}>
              {k.value}
            </span>
            <span className="truncate text-xs text-black/50 dark:text-white/50">{k.sub}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-4">
        <section className="flex min-w-0 flex-[2_1_420px] flex-col gap-2 rounded-xl border border-black/10 p-4 dark:border-white/10 dark:bg-white/[0.03]">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-extrabold tracking-wider text-amber-500 uppercase">Needs a person</h3>
            <Link href="/admin/inbox" className="text-sm text-[#bf5af2]">
              Open inbox
            </Link>
          </div>
          <InboxPanel initial={inbox} limit={5} />
        </section>
        <section className="flex min-w-0 flex-[1_1_260px] flex-col gap-2 rounded-xl border border-black/10 p-4 dark:border-white/10 dark:bg-white/[0.03]">
          <h3 className="text-xs font-extrabold tracking-wider text-[#bf5af2] uppercase">Jobs</h3>
          <AdminJobs initialJobs={health.jobs} />
        </section>
      </div>

      {leagues && (
        <section className="flex flex-col gap-2 rounded-xl border border-black/10 p-4 dark:border-white/10 dark:bg-white/[0.03]">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-extrabold tracking-wider text-black/50 uppercase dark:text-white/50">Leagues</h3>
            <Link href="/admin/leagues" className="text-sm text-[#bf5af2]">
              All {leagues.leagues.length}
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs text-black/50 dark:text-white/50">
                  <th className="px-1.5 py-2 font-bold">League</th>
                  <th className="px-1.5 py-2 font-bold">Source</th>
                  <th className="px-1.5 py-2 font-bold">People</th>
                  <th className="px-1.5 py-2 font-bold">Active 7d</th>
                  <th className="px-1.5 py-2 font-bold">Started</th>
                </tr>
              </thead>
              <tbody>
                {leagues.leagues.map((l) => (
                  <tr key={l.id} className="border-t border-black/5 dark:border-white/5">
                    <td className="px-1.5 py-2.5 font-semibold">
                      <Link href={`/admin/leagues/${l.id}`} className="hover:underline">
                        {l.name}
                      </Link>
                    </td>
                    <td className="px-1.5 py-2.5 text-black/60 dark:text-white/60">{SOURCE_LABEL[l.source]}</td>
                    <td className="px-1.5 py-2.5 tabular-nums">{l.member_count}</td>
                    <td className={`px-1.5 py-2.5 tabular-nums ${l.active_members === 0 ? "text-black/40 dark:text-white/40" : ""}`}>
                      {l.active_members}
                    </td>
                    <td className="px-1.5 py-2.5 text-black/60 dark:text-white/60">
                      {new Date(l.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
