import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import {
  awardsHrefFor,
  getAllTimePowerRankings,
  getLatestPowerRankingsWeek,
  getMe,
  getSeasonPowerRankingsTrend,
  getWeekPowerRankings,
  listSeasons,
  safeLatestSeason,
  type PowerRankTrendTeam,
  type WeekPowerRanking,
} from "@/lib/api";
import { LeagueSubNav } from "@/components/nav/LeagueSubNav";
import { MovementBadge } from "@/components/MovementBadge";
import { NeedsLeagueCard } from "@/components/NeedsLeagueCard";
import { SeasonTabs } from "@/components/nav/SeasonTabs";
import { SignInCard } from "@/components/SignInCard";
import { PowerRankingsAllTime } from "@/components/PowerRankingsAllTime";
import { SECTION_COLORS, panelGlowStyle } from "@/lib/sectionColors";

export const metadata: Metadata = { title: "Power Rankings — Weekend League" };

type View = "week" | "trend" | "all-time";

const VIEW_TABS: { key: View; label: string }[] = [
  { key: "week", label: "This Week" },
  { key: "trend", label: "Season Trend" },
  { key: "all-time", label: "All-Time" },
];

function hrefFor(view: View, season?: number): string {
  const params = new URLSearchParams({ view });
  if (season) params.set("season", String(season));
  return `/power-rankings?${params.toString()}`;
}

export default async function PowerRankingsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; season?: string; week?: string }>;
}) {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session")?.value;
  const me = await getMe(sessionCookie);
  if (!me) {
    return (
      <div className="flex justify-center py-6">
        <SignInCard />
      </div>
    );
  }
  if (me.active_league_id === null) {
    return <NeedsLeagueCard />;
  }

  const { view: rawView, season: rawSeason, week: rawWeek } = await searchParams;
  const view: View = rawView === "trend" || rawView === "all-time" ? rawView : "week";

  const { seasons } = await listSeasons();
  const latestSeason = safeLatestSeason(seasons);
  const season = rawSeason ? Number(rawSeason) : latestSeason;

  return (
    <div className="flex flex-col gap-4">
      <LeagueSubNav active="powerRankings" awardsHref={awardsHrefFor(latestSeason)} />
      <div>
        <h1 className="text-2xl font-semibold">Power Rankings</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          Who&apos;s actually good — combined record, scoring, and recent form — plus each team&apos;s Luck
          Index and Strength of Schedule alongside it.
        </p>
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
        {VIEW_TABS.map((tab) => (
          <Link
            key={tab.key}
            href={hrefFor(tab.key, season ?? undefined)}
            className={view === tab.key ? "font-semibold underline" : "text-black/60 hover:underline dark:text-white/60"}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {view !== "all-time" && season !== null && (
        <SeasonTabs seasons={seasons} activeSeason={season} hrefFor={(s) => hrefFor(view, s)} />
      )}

      {view === "all-time" && <AllTimeView sessionCookie={sessionCookie} />}
      {view === "week" && season !== null && (
        <WeekView season={season} requestedWeek={rawWeek} sessionCookie={sessionCookie} />
      )}
      {view === "trend" && season !== null && <TrendView season={season} sessionCookie={sessionCookie} />}
      {season === null && view !== "all-time" && (
        <p className="text-sm text-black/50 dark:text-white/50">No seasons found yet.</p>
      )}
    </div>
  );
}

async function AllTimeView({ sessionCookie }: { sessionCookie: string | undefined }) {
  const { categories } = await getAllTimePowerRankings(sessionCookie);
  return <PowerRankingsAllTime categories={categories} />;
}

async function WeekView({
  season,
  requestedWeek,
  sessionCookie,
}: {
  season: number;
  requestedWeek?: string;
  sessionCookie: string | undefined;
}) {
  const { week: latestWeek } = await getLatestPowerRankingsWeek(season, sessionCookie);
  const week = requestedWeek ? Number(requestedWeek) : latestWeek;

  if (week === null) {
    return (
      <p className="text-sm text-black/50 dark:text-white/50">
        No power rankings computed for {season} yet — this fills in once a sync has run for at least one
        completed week.
      </p>
    );
  }

  const { rankings } = await getWeekPowerRankings(season, week, sessionCookie);

  return (
    <section
      className="neon-panel flex flex-col rounded-lg"
      style={panelGlowStyle(SECTION_COLORS.powerRankings)}
    >
      {/* overflow-x-auto, matching TrendView's table below — belt-and-
          suspenders for whatever doesn't fit the tightened widths at
          extreme accessibility text sizes or very long names, so it's
          reachable via horizontal swipe instead of being silently
          clipped by globals.css's page-level overflow-x: hidden.
          divide-y moved down here (was on the <section> itself) so row
          dividers still render now that the header/rows are one level
          deeper, inside this scroll wrapper. */}
      <div className="overflow-x-auto">
        <div className="flex min-w-full flex-col divide-y divide-black/5 dark:divide-white/5">
          <div className="flex items-center justify-between gap-2 px-4 py-2 text-xs font-semibold text-black/50 uppercase dark:text-white/50">
            <span>Week {week}</span>
            <span className="flex shrink-0 gap-2">
              <span className="w-10 text-right">Luck</span>
              <span className="w-10 text-right">SOS</span>
              <span className="w-10 text-right">Trend</span>
            </span>
          </div>
          {rankings.map((r: WeekPowerRanking) => (
            <div key={r.team_id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
              <div className="flex min-w-0 items-center gap-3">
                <span className="w-6 shrink-0 text-center font-bold tabular-nums">{r.power_rank}</span>
                <div className="min-w-0">
                  <p className="truncate font-medium">{r.team_name}</p>
                  <p className="truncate text-xs text-black/50 dark:text-white/50">{r.owner_name}</p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2 tabular-nums">
                <span className="w-10 text-right text-xs text-black/60 dark:text-white/60">
                  {r.luck_score !== null ? r.luck_score.toFixed(1) : "—"}
                </span>
                <span className="w-10 text-right text-xs text-black/60 dark:text-white/60">
                  {r.sos !== null ? r.sos.toFixed(2) : "—"}
                </span>
                <span className="w-10 text-right text-xs">
                  <MovementBadge movement={r.movement} />
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
      {rankings.length === 0 && (
        <p className="px-4 py-3 text-sm text-black/50 dark:text-white/50">No data for week {week}.</p>
      )}
    </section>
  );
}

async function TrendView({ season, sessionCookie }: { season: number; sessionCookie: string | undefined }) {
  const { teams } = await getSeasonPowerRankingsTrend(season, sessionCookie);
  const allWeeks = Array.from(new Set(teams.flatMap((t) => t.weeks.map((w) => w.week)))).sort((a, b) => a - b);

  if (teams.length === 0) {
    return <p className="text-sm text-black/50 dark:text-white/50">No power rankings computed for {season} yet.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] text-sm">
        <thead>
          <tr className="text-xs text-black/50 uppercase dark:text-white/50">
            <th className="px-2 py-2 text-left">Team</th>
            {allWeeks.map((w) => (
              <th key={w} className="px-2 py-2 text-center">
                Wk {w}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-black/5 dark:divide-white/5">
          {teams.map((t: PowerRankTrendTeam) => {
            const rankByWeek = new Map(t.weeks.map((w) => [w.week, w.power_rank]));
            return (
              <tr key={t.team_id}>
                <td className="px-2 py-2 font-medium">
                  <p className="truncate">{t.team_name}</p>
                  <p className="truncate text-xs text-black/50 dark:text-white/50">{t.owner_name}</p>
                </td>
                {allWeeks.map((w) => (
                  <td key={w} className="px-2 py-2 text-center tabular-nums">
                    {rankByWeek.get(w) ?? "—"}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
