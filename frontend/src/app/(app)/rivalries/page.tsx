import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { awardsHrefFor, getActiveLeagueName, getMe, listRivalries, listSeasons, safeLatestSeason } from "@/lib/api";
import { LeagueSubNav } from "@/components/nav/LeagueSubNav";
import { NeedsLeagueCard } from "@/components/NeedsLeagueCard";
import { SignInCard } from "@/components/SignInCard";
import { SECTION_COLORS, panelGlowStyle } from "@/lib/sectionColors";

export const metadata: Metadata = { title: "Rivalries — Weekend League" };

export default async function RivalriesPage() {
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

  const [{ rivalries }, { seasons }, activeLeagueName] = await Promise.all([
    listRivalries(sessionCookie),
    listSeasons(),
    getActiveLeagueName(sessionCookie),
  ]);
  const latestSeason = safeLatestSeason(seasons);

  return (
    <div className="flex flex-col gap-4">
      <LeagueSubNav active="rivalries" awardsHref={awardsHrefFor(latestSeason)} activeLeagueName={activeLeagueName} />
      <h1 className="text-2xl font-semibold">Rivalries</h1>

      {rivalries.length === 0 ? (
        <p className="text-sm text-black/50 dark:text-white/50">No rivalries recorded.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {rivalries.map((r) => (
            <li key={r.id} className="neon-panel rounded-lg p-4" style={panelGlowStyle(SECTION_COLORS.rivalries)}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h2 className="font-medium">
                  {r.emoji && <span className="mr-1">{r.emoji}</span>}
                  {r.name ?? `${r.owner_a_name} vs ${r.owner_b_name}`}
                </h2>
                {r.tier && (
                  <span className="rounded-full border border-black/10 px-2 py-0.5 text-xs text-black/60 dark:border-white/10 dark:text-white/60">
                    {r.tier}
                  </span>
                )}
              </div>
              {r.tagline && <p className="mt-1 text-sm italic text-black/60 dark:text-white/60">{r.tagline}</p>}
              {r.description && <p className="mt-2 text-sm text-black/70 dark:text-white/70">{r.description}</p>}
              <div className="mt-3 flex items-center justify-between text-sm">
                <Link href={`/owners/${r.owner_a_id}`} className="hover:underline">
                  {r.owner_a_name}
                </Link>
                <span className="tabular-nums text-black/50 dark:text-white/50">
                  {r.all_time_wins_a}-{r.all_time_wins_b}
                </span>
                <Link href={`/owners/${r.owner_b_id}`} className="hover:underline">
                  {r.owner_b_name}
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
