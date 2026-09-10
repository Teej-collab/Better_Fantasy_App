import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import {
  getCurrentWeek,
  getMe,
  getMyFreeAgents,
  getWaiverPriority,
  getWaiverSettings,
  listSeasons,
  resolveWeek,
  safeLatestSeason,
} from "@/lib/api";
import { FreeAgentsList } from "@/components/FreeAgentsList";
import { MyTeamSubNav } from "@/components/nav/MyTeamSubNav";
import { MyWaiverClaims } from "@/components/MyWaiverClaims";
import { NeedsLeagueCard } from "@/components/NeedsLeagueCard";
import { PlayerSearchInput } from "@/components/PlayerSearchInput";
import { SignInCard } from "@/components/SignInCard";

export const metadata: Metadata = { title: "Free Agents — Weekend League" };

const POSITIONS = ["QB", "RB", "WR", "TE", "D/ST", "K"];

// players.position stores defenses as "DEF" (Sleeper's own value — see
// backend/app/providers/sleeper/ingest.py), not the "D/ST" display
// label — the same translation RosterSlotsSection.tsx's own
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

  const { seasons } = await listSeasons();
  const latestSeason = safeLatestSeason(seasons);
  const { current_week: currentWeek } =
    latestSeason !== null ? await getCurrentWeek(latestSeason) : { current_week: null };
  const week = resolveWeek(currentWeek);

  const [players, waiverSettings, waiverPriority] = await Promise.all([
    getMyFreeAgents(sessionCookie, position, search),
    getWaiverSettings(),
    latestSeason !== null ? getWaiverPriority(latestSeason, week, sessionCookie) : Promise.resolve(null),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <MyTeamSubNav active="freeAgents" />
      <h1 className="text-2xl font-semibold">Free Agents</h1>

      <p className="text-sm text-black/50 dark:text-white/50">
        Every player not currently on a roster in this league, sorted by real fantasy relevance. This league uses{" "}
        {waiverSettings.uses_faab ? `FAAB bidding ($${waiverSettings.acquisition_budget} budget)` : "standard waiver priority"}
        .
      </p>

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
        {POSITIONS.map((p) => {
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

      <FreeAgentsList players={players} />
    </div>
  );
}
