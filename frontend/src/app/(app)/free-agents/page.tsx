import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import {
  getCurrentWeek,
  getMe,
  getMyFreeAgents,
  getTrendingPlayers,
  getWaiverPriority,
  getWaiverSettings,
  listSeasons,
  resolveWeek,
  safeLatestSeason,
} from "@/lib/api";
import { ANTON, SATISFY, ELITE } from "@/components/elite/Elite";
import { FreeAgentsList } from "@/components/FreeAgentsList";
import { TrendingRail } from "@/components/TrendingRail";
import { MyTeamSubNav } from "@/components/nav/MyTeamSubNav";
import { MyWaiverClaims } from "@/components/MyWaiverClaims";
import { NeedsLeagueCard } from "@/components/NeedsLeagueCard";
import { PlayerSearchInput } from "@/components/PlayerSearchInput";
import { SignInCard } from "@/components/SignInCard";

export const metadata: Metadata = { title: "Free Agents — The Weekend" };

const POSITIONS = ["QB", "RB", "WR", "TE", "D/ST", "K"];

// players.position stores defenses as "DEF" (Sleeper's own value — see
// backend/app/providers/sleeper/ingest.py), not the "D/ST" display
// label — the same translation RosterHiveBuilder.tsx's own
// SLOT_TO_POSITION already makes. Without it, the D/ST tab's query
// (?position=D/ST) matched zero rows against the real stored value
// (2026-09, reported: real available defenses never showed up here).
const POSITION_TO_QUERY_VALUE: Record<string, string> = {
  QB: "QB",
  RB: "RB",
  WR: "WR",
  TE: "TE",
  "D/ST": "DEF",
  K: "K",
  DL: "DL",
  LB: "LB",
  DB: "DB",
};

export default async function FreeAgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ position?: string; search?: string }>;
}) {
  const { position, search } = await searchParams;
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session")?.value;
  const me = await getMe(sessionCookie);

  if (!me) {
    return (
      <div className="flex flex-col gap-4">
        <MyTeamSubNav active="freeAgents" />
        <div className="flex justify-center py-6">
          <SignInCard />
        </div>
      </div>
    );
  }
  if (me.active_league_id === null) {
    return (
      <div className="flex flex-col gap-4">
        <MyTeamSubNav active="freeAgents" />
        <NeedsLeagueCard />
      </div>
    );
  }

  const { seasons } = await listSeasons(sessionCookie);
  const latestSeason = safeLatestSeason(seasons);
  const { current_week: currentWeek } =
    latestSeason !== null ? await getCurrentWeek(latestSeason) : { current_week: null };
  const week = resolveWeek(currentWeek);

  // Trending is a side rail: a failed fetch just leaves it out.
  const trending = (kind: "add" | "drop") =>
    getTrendingPlayers(sessionCookie, { kind, window: "24h", source: "auto" }).catch(() => null);
  const [players, waiverSettings, waiverPriority, trendingAdds, trendingDrops] = await Promise.all([
    getMyFreeAgents(sessionCookie, position, search),
    getWaiverSettings(),
    latestSeason !== null ? getWaiverPriority(latestSeason, week, sessionCookie) : Promise.resolve(null),
    trending("add"),
    trending("drop"),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <MyTeamSubNav active="freeAgents" />
      {/* Elite (Web A "Wire Room", 2026-11-05): title left, waiver facts right. */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col leading-none">
          <span className={`${SATISFY} text-2xl`} style={{ color: ELITE.orange }}>
            the
          </span>
          <h1
            className={`${ANTON} text-4xl tracking-wide sm:text-5xl`}
            style={{ color: ELITE.green, textShadow: "0 0 8px rgba(57,255,20,.7), 0 0 22px rgba(57,255,20,.35)" }}
          >
            FREE AGENTS
          </h1>
        </div>
        <span className="rounded-xl border border-black/10 px-3 py-2 text-xs text-black/60 dark:border-white/10 dark:text-white/60">
          {waiverSettings.uses_faab ? `FAAB · $${waiverSettings.acquisition_budget} budget` : "Waiver priority"}
        </span>
      </div>

      <div className="flex flex-wrap items-start gap-5">
      <section className="flex min-w-0 flex-[999_1_640px] flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <PlayerSearchInput />
      </div>

      <div className="flex flex-wrap gap-x-3 text-sm">
        <Link
          href={{ pathname: "/free-agents", query: search ? { search } : undefined }}
          className={
            !position ? "font-semibold underline" : "text-black/60 hover:underline dark:text-white/60"
          }
        >
          All
        </Link>
        {[...POSITIONS, ...(me.league_format?.roster_preset === "idp" ? ["DL", "LB", "DB"] : [])].map((p) => {
          const queryValue = POSITION_TO_QUERY_VALUE[p];
          return (
            <Link
              key={p}
              href={{ pathname: "/free-agents", query: { position: queryValue, ...(search ? { search } : {}) } }}
              className={
                position === queryValue ? "font-semibold underline" : "text-black/60 hover:underline dark:text-white/60"
              }
            >
              {p}
            </Link>
          );
        })}
      </div>

      <MyWaiverClaims />

      {waiverPriority && waiverPriority.priority_order.length > 0 && (
        <details className="neon-panel rounded-lg bg-black/[0.015] px-4 py-2.5 text-sm dark:bg-white/[0.03]">
          <summary className="cursor-pointer text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
            Waiver order — Week {waiverPriority.week}
          </summary>
          <p className="mt-2 text-xs text-black/50 dark:text-white/50">
            Resets each week to the inverse of standings — worst record claims first. Winning a claim moves that team
            to the back of this list until next week.
          </p>
          <ol className="mt-2 flex flex-col gap-1">
            {waiverPriority.priority_order.map((row) => (
              <li key={row.team_id} className="flex gap-2 text-black/70 dark:text-white/70">
                <span className="w-5 tabular-nums text-black/50 dark:text-white/50">{row.priority}.</span>
                <span>{row.team_name}</span>
              </li>
            ))}
          </ol>
        </details>
      )}

      <FreeAgentsList players={players} bidding={me.league_format?.league_type === "guillotine"} />
      </section>
      <aside className="w-full flex-[1_1_320px] lg:sticky lg:top-4 lg:max-w-[360px]">
        <TrendingRail adds={trendingAdds} drops={trendingDrops} />
      </aside>
      </div>
    </div>
  );
}