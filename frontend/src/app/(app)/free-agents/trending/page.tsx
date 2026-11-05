import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import {
  getMe,
  getTrendingPlayers,
  type TrendingKind,
  type TrendingSource,
  type TrendingWindow,
} from "@/lib/api";
import { MyTeamSubNav } from "@/components/nav/MyTeamSubNav";
import { NeedsLeagueCard } from "@/components/NeedsLeagueCard";
import { SignInCard } from "@/components/SignInCard";
import { TrendingPlayersList } from "@/components/TrendingPlayersList";

export const metadata: Metadata = { title: "Trending Players — The Weekend" };

// Same label → stored players.position mapping as the Free Agents page.
const POSITIONS: [string, string][] = [
  ["QB", "QB"],
  ["RB", "RB"],
  ["WR", "WR"],
  ["TE", "TE"],
  ["D/ST", "DEF"],
  ["K", "K"],
];
const WINDOW_LABEL: Record<TrendingWindow, string> = { "24h": "24 hours", "7d": "7 days", season: "Season" };

type Params = { kind?: string; window?: string; source?: string; position?: string };

function pick<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function FilterLink({ label, active, query }: { label: string; active: boolean; query: Params }) {
  const clean = Object.fromEntries(Object.entries(query).filter(([, v]) => v)) as Record<string, string>;
  return (
    <Link
      href={{ pathname: "/free-agents/trending", query: clean }}
      className={active ? "font-semibold underline" : "text-black/60 hover:underline dark:text-white/60"}
    >
      {label}
    </Link>
  );
}

export default async function TrendingPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const source = pick<TrendingSource>(params.source, ["app", "sleeper"], "app");
  const kind = pick<TrendingKind>(params.kind, ["add", "drop"], "add");
  // Sleeper's feed only looks back by hours, so no season view there.
  const windows: TrendingWindow[] = source === "sleeper" ? ["24h", "7d"] : ["24h", "7d", "season"];
  const lookback = pick<TrendingWindow>(params.window, windows, source === "app" ? "7d" : "24h");
  const position = params.position || undefined;
  const state: Params = { source, kind, window: lookback, position };

  const sessionCookie = (await cookies()).get("session")?.value;
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

  const data = await getTrendingPlayers(sessionCookie, { kind, window: lookback, source, position });

  return (
    <div className="flex flex-col gap-4">
      <MyTeamSubNav active="freeAgents" />
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold">Trending</h1>
        <Link href="/free-agents" className="text-sm text-black/60 hover:underline dark:text-white/60">
          ← Free Agents
        </Link>
      </div>
      <p className="text-sm text-black/50 dark:text-white/50">
        {source === "app"
          ? `The most ${kind === "add" ? "added" : "dropped"} players across ${data?.leagues_tracked ?? 0} ${
              data?.leagues_tracked === 1 ? "league" : "leagues"
            } on The Weekend, including moves made on ESPN and Sleeper in connected leagues.`
          : `The most ${kind === "add" ? "added" : "dropped"} players across every Sleeper league.`}
      </p>

      <div className="flex flex-col gap-2 text-sm">
        <div className="flex flex-wrap gap-x-3">
          <FilterLink label="The Weekend" active={source === "app"} query={{ ...state, source: "app" }} />
          <FilterLink label="All of Sleeper" active={source === "sleeper"} query={{ ...state, source: "sleeper" }} />
          <span className="text-black/20 dark:text-white/20">|</span>
          <FilterLink label="Adds" active={kind === "add"} query={{ ...state, kind: "add" }} />
          <FilterLink label="Drops" active={kind === "drop"} query={{ ...state, kind: "drop" }} />
          <span className="text-black/20 dark:text-white/20">|</span>
          {windows.map((w) => (
            <FilterLink key={w} label={WINDOW_LABEL[w]} active={lookback === w} query={{ ...state, window: w }} />
          ))}
        </div>
        <div className="flex flex-wrap gap-x-3">
          <FilterLink label="All" active={!position} query={{ ...state, position: undefined }} />
          {POSITIONS.map(([label, value]) => (
            <FilterLink key={value} label={label} active={position === value} query={{ ...state, position: value }} />
          ))}
        </div>
      </div>

      {data && <TrendingPlayersList data={data} />}
    </div>
  );
}
