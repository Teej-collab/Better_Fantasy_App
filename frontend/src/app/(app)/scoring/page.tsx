import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { awardsHrefFor, getActiveLeagueName, getMe, getScoringCatalogServer, listSeasons, safeLatestSeason } from "@/lib/api";
import { LeagueSubNav } from "@/components/nav/LeagueSubNav";
import { NeedsLeagueCard } from "@/components/NeedsLeagueCard";
import { SignInCard } from "@/components/SignInCard";
import { SECTION_COLORS, panelGlowStyle } from "@/lib/sectionColors";
import { detailLabel, pointsLabel, scoredGroups, scoringSummary } from "@/lib/scoringDisplay";

export const metadata: Metadata = { title: "Scoring — The Weekend" };

// League → Scoring (2026-10-22): the league's full scoring rules, the
// way ESPN's league settings page lists them. Read-only; the
// commissioner changes them in Commissioner Tools → Scoring. Lives
// under Rules in the sub-nav.

export default async function ScoringPage() {
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

  const [catalog, { seasons }, activeLeagueName] = await Promise.all([
    getScoringCatalogServer(sessionCookie),
    listSeasons(sessionCookie),
    getActiveLeagueName(sessionCookie),
  ]);
  const latestSeason = safeLatestSeason(seasons);

  return (
    <div className="flex flex-col gap-5">
      <LeagueSubNav active="rules" awardsHref={awardsHrefFor(latestSeason)} activeLeagueName={activeLeagueName} />
      <div className="flex flex-col gap-1">
        <Link href="/rules" className="text-sm text-black/50 hover:underline dark:text-white/50">
          ‹ Rules
        </Link>
        <h1 className="text-2xl font-semibold">Scoring</h1>
      </div>

      {!catalog ? (
        <p className="text-sm text-black/50 dark:text-white/50">Couldn&apos;t load the scoring rules. Try again in a minute.</p>
      ) : (
        <>
          <ul className="flex flex-wrap gap-2" aria-label="Scoring format">
            {scoringSummary(catalog).map((chip) => (
              <li
                key={chip}
                className="rounded-md border border-black/10 bg-black/[0.03] px-3 py-1 text-sm font-semibold dark:border-white/15 dark:bg-white/[0.05]"
              >
                {chip}
              </li>
            ))}
          </ul>

          <div className="grid gap-4 md:grid-cols-2">
            {scoredGroups(catalog).map((group) => (
              <section
                key={group.key}
                className="neon-panel flex flex-col rounded-xl p-4"
                style={panelGlowStyle(SECTION_COLORS.rules)}
                aria-labelledby={`scoring-${group.key}`}
              >
                <div className="mb-1 flex items-center gap-2.5 border-b-2 pb-2.5" style={{ borderBottomColor: group.color }}>
                  <h2 id={`scoring-${group.key}`} className="flex-1 text-xl font-extrabold">
                    {group.label}
                  </h2>
                  <span className="text-xs font-bold" style={{ color: group.color }}>
                    {group.stats.length} {group.stats.length === 1 ? "rule" : "rules"}
                  </span>
                </div>
                <dl className="flex flex-col">
                  {group.stats.map((stat) => {
                    const value = stat.value ?? 0;
                    return (
                      <div
                        key={stat.key}
                        className="flex items-center justify-between gap-4 border-t border-black/5 py-2.5 first:border-0 dark:border-white/[0.08]"
                      >
                        <dt className="flex flex-col gap-0.5">
                          <span className="font-medium">{stat.label}</span>
                          <span className="text-xs text-black/55 dark:text-white/55">
                            {detailLabel(stat)}
                            {stat.tracked ? "" : " · not tracked yet"}
                          </span>
                        </dt>
                        <dd
                          className={`shrink-0 text-right text-base font-extrabold tabular-nums ${
                            value < 0
                              ? "text-red-600 dark:text-red-400"
                              : value > 0
                                ? "text-emerald-700 dark:text-emerald-400"
                                : "text-black/45 dark:text-white/50"
                          }`}
                        >
                          {pointsLabel(value)}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </section>
            ))}
          </div>

          <p className="text-center text-xs text-black/50 dark:text-white/50">
            {catalog.season} season. Anything not listed scores 0. Your commissioner sets these in Commissioner Tools.
          </p>
        </>
      )}
    </div>
  );
}
