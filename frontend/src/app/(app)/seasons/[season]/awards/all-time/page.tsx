import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getActiveLeagueName, getAwardLeaderboards, getMe, getRecordBook, listSeasons, type RecordEntry } from "@/lib/api";
import { AWARD_DESCRIPTIONS } from "@/lib/awardDescriptions";
import { ELITE, EliteLabel, EliteSeasonChips, EliteTitle, PodiumBoard } from "@/components/elite/Elite";
import { LeagueSubNav } from "@/components/nav/LeagueSubNav";
import { NeedsLeagueCard } from "@/components/NeedsLeagueCard";
import { SignInCard } from "@/components/SignInCard";
import { BackButton } from "@/components/BackButton";

export const metadata: Metadata = { title: "All-Time Records — The Weekend" };

/**
 * The All-Time Records tab of Awards — a pinned tab in SeasonTabs
 * alongside every season, not one more season itself (the record book
 * spans the league's whole history, see RecordBook.tsx). Kept under
 * /seasons/[season]/awards/ rather than a standalone /awards/all-time
 * route so the URL still carries which season you were last looking
 * at, matching the season tabs right next to it.
 */
export default async function AllTimeRecordsPage({
  params,
}: {
  params: Promise<{ season: string }>;
}) {
  const { season } = await params;
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

  const [{ seasons }, { categories }, { categories: awardCategories }, activeLeagueName] = await Promise.all([
    listSeasons(sessionCookie),
    getRecordBook(sessionCookie),
    getAwardLeaderboards(sessionCookie),
    getActiveLeagueName(sessionCookie),
  ]);
  const records = categories.filter((c) => c.entries.length > 0);

  return (
    <div className="flex flex-col gap-4">
      <BackButton fallbackHref={`/seasons/${season}/awards`} label="Awards" />
      <LeagueSubNav active="history" awardsHref={`/seasons/${season}/awards`} activeLeagueName={activeLeagueName} />
      <EliteTitle kicker="The All-Time" title="Trophy Wall" />
      <EliteSeasonChips
        seasons={seasons}
        activeSeason={null}
        hrefFor={(s) => `/seasons/${s}/awards`}
        extraTab={{ label: "All-Time Records", href: `/seasons/${season}/awards/all-time`, active: true }}
      />

      {records.length > 0 && (
        <section className="flex flex-col gap-3">
          <div>
            <EliteLabel color={ELITE.green}>All-Time Records</EliteLabel>
            <p className="text-xs text-black/50 dark:text-white/50">The league&apos;s history, updated the moment a record is broken.</p>
          </div>
          {records.map((c) => (
            <PodiumBoard
              key={c.key}
              title={c.label}
              description={AWARD_DESCRIPTIONS[c.key]}
              entries={c.entries.map((e) => ({
                key: `${e.owner_id}-${e.season}-${e.week ?? "season"}`,
                name: e.owner_name,
                value: `${e.value.toFixed(1)} ${c.unit}`,
                context: `${e.team_name} · ${recordContext(e)}`,
                href: `/owners/${e.owner_id}`,
              }))}
            />
          ))}
        </section>
      )}
      {awardCategories.length > 0 && (
        <section className="flex flex-col gap-3">
          <div>
            <EliteLabel color={ELITE.green}>All-Time Awards</EliteLabel>
            <p className="text-xs text-black/50 dark:text-white/50">Every yearly award the league hands out, and who&apos;s won it the most.</p>
          </div>
          {awardCategories.map((c) => (
            <PodiumBoard
              key={c.key}
              title={c.label}
              description={AWARD_DESCRIPTIONS[c.key]}
              emptyMessage="Not yet awarded."
              entries={c.winners.map((w) => ({ key: String(w.owner_id), name: w.owner_name, value: `${w.wins}x`, href: `/owners/${w.owner_id}` }))}
            />
          ))}
        </section>
      )}
    </div>
  );
}

function recordContext(entry: RecordEntry): string {
  if (entry.opponent_team_name) {
    // Biggest Blowout — own_score is only ever present on this category.
    const ownScore = entry.own_score !== undefined ? entry.own_score.toFixed(1) : null;
    return ownScore
      ? `${ownScore} – ${entry.opponent_score?.toFixed(1)} vs ${entry.opponent_team_name} · Season ${entry.season}${entry.week ? `, Wk ${entry.week}` : ""}`
      : `vs ${entry.opponent_team_name} · Season ${entry.season}`;
  }
  return entry.week ? `Season ${entry.season}, Week ${entry.week}` : `Season ${entry.season}`;
}
