import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { getMe, getWeekMatchupContext, getWeeklyAwards, getWeeklyRecap, type WeeklyAwards } from "@/lib/api";
import { NeedsLeagueCard } from "@/components/NeedsLeagueCard";
import { PlayoffBadge } from "@/components/PlayoffBadge";
import { WeekScoreboardList } from "@/components/matchups/WeekScoreboardList";
import { SignInCard } from "@/components/SignInCard";
import { WeekRecapSection } from "@/components/WeekRecapSection";

const WEEK_OPTIONS = Array.from({ length: 17 }, (_, i) => i + 1);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ season: string; week: string }>;
}): Promise<Metadata> {
  const { season, week } = await params;
  return { title: `${season} Week ${week} — Weekend League` };
}

export default async function WeekMatchupsPage({
  params,
}: {
  params: Promise<{ season: string; week: string }>;
}) {
  const { season, week } = await params;
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

  const [{ matchups }, awards, { narrative }] = await Promise.all([
    getWeekMatchupContext(Number(season), Number(week), sessionCookie),
    getWeeklyAwards(Number(season), Number(week), sessionCookie),
    getWeeklyRecap(Number(season), Number(week), sessionCookie),
  ]);
  const isPlayoffWeek = matchups.some((m) => m.is_playoff);
  const played = matchups.some((m) => m.home.score !== null);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="flex items-center gap-2 text-2xl font-semibold">
        {season} — Week {week}
        {isPlayoffWeek && <PlayoffBadge />}
      </h1>

      <div className="flex flex-wrap gap-2 text-sm">
        {WEEK_OPTIONS.map((w) => (
          <Link
            key={w}
            href={`/seasons/${season}/weeks/${w}`}
            className={
              String(w) === week
                ? "rounded-full border border-black/20 bg-black/5 px-3 py-1.5 font-semibold dark:border-white/20 dark:bg-white/10"
                : "rounded-full border border-black/10 px-3 py-1.5 text-black/60 hover:bg-black/5 dark:border-white/10 dark:text-white/60 dark:hover:bg-white/10"
            }
          >
            {w}
          </Link>
        ))}
      </div>

      <WeekRecapSection
        season={Number(season)}
        week={Number(week)}
        narrative={narrative}
        canGenerate={me.is_commissioner && matchups.length > 0}
      />

      {matchups.length === 0 ? (
        <p className="text-sm text-black/50 dark:text-white/50">No matchups for this week.</p>
      ) : (
        <WeekScoreboardList matchups={matchups} />
      )}

      {played && <WeeklyAwardsSection awards={awards} />}
    </div>
  );
}

function WeeklyAwardsSection({ awards }: { awards: WeeklyAwards }) {
  const items: { label: string; content: ReactNode }[] = [];

  if (awards.game_of_the_week) {
    items.push({
      label: "Game of the week",
      content: `${awards.game_of_the_week.winner} won, ${awards.game_of_the_week.score}`,
    });
  }
  if (awards.overachiever) {
    items.push({
      label: "Overachiever",
      content: `${awards.overachiever.team_name} (+${awards.overachiever.diff.toFixed(1)} vs. expected)`,
    });
  }
  if (awards.meltdown) {
    items.push({
      label: "Meltdown",
      content: `${awards.meltdown.team_name} (${awards.meltdown.diff.toFixed(1)} vs. expected)`,
    });
  }
  if (awards.clutch) {
    items.push({ label: "Clutch", content: `${awards.clutch.team_name} — ${awards.clutch.reason}` });
  }
  if (awards.choke) {
    items.push({ label: "Choke", content: `${awards.choke.team_name} — ${awards.choke.reason}` });
  }
  if (awards.biggest_bench_crime) {
    const bc = awards.biggest_bench_crime;
    items.push({
      label: "Biggest bench crime",
      content: `${bc.team_name} benched ${bc.bench_player} for ${bc.started_player} (${bc.severity})`,
    });
  }

  if (items.length === 0 && awards.boom_leaders.length === 0 && awards.bust_leaders.length === 0) return null;

  return (
    <section className="flex flex-col gap-3 border-t border-black/10 pt-4 dark:border-white/10">
      <h2 className="font-medium">Weekly Awards</h2>
      {items.length > 0 && (
        <ul className="flex flex-col divide-y divide-black/5 text-sm dark:divide-white/5">
          {items.map((item, i) => (
            <li key={i} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-baseline sm:gap-2">
              <span className="w-40 shrink-0 text-black/50 dark:text-white/50">{item.label}</span>
              <span>{item.content}</span>
            </li>
          ))}
        </ul>
      )}
      {awards.boom_leaders.length > 0 && (
        <BoomBustList title="Boom" players={awards.boom_leaders} />
      )}
      {awards.bust_leaders.length > 0 && (
        <BoomBustList title="Bust" players={awards.bust_leaders} />
      )}
    </section>
  );
}

function BoomBustList({
  title,
  players,
}: {
  title: string;
  players: { player_name: string; points_scored: number; team_name: string }[];
}) {
  return (
    <div>
      <h3 className="mb-1 text-sm text-black/50 dark:text-white/50">{title}</h3>
      <ul className="flex flex-col gap-0.5 text-sm">
        {players.map((p, i) => (
          <li key={i} className="flex justify-between">
            <span>
              {p.player_name} <span className="text-black/50 dark:text-white/50">({p.team_name})</span>
            </span>
            <span className="tabular-nums">{p.points_scored.toFixed(1)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
