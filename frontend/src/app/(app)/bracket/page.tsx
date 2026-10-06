import type { Metadata } from "next";
import { cookies } from "next/headers";
import { awardsHrefFor, getActiveLeagueName, getMe, listSeasons, safeLatestSeason } from "@/lib/api";
import { BracketExperience } from "@/components/bracket/BracketExperience";
import { LeagueSubNav } from "@/components/nav/LeagueSubNav";
import { NeedsLeagueCard } from "@/components/NeedsLeagueCard";
import { SignInCard } from "@/components/SignInCard";

export const metadata: Metadata = { title: "Bracket — The Weekend" };

// The 3D playoff bracket, Your Path and the What-If Lab (2026-10) —
// components/bracket/BracketExperience.tsx. ?mode= picks the view and
// ?w= carries a shared what-if.
export default async function BracketPage({ searchParams }: { searchParams: Promise<{ mode?: string; w?: string }> }) {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session")?.value;
  const [me, activeLeagueName, { seasons }, { mode, w }] = await Promise.all([
    getMe(sessionCookie),
    getActiveLeagueName(sessionCookie),
    listSeasons(),
    searchParams,
  ]);
  if (!me) {
    return (
      <div className="flex justify-center py-6">
        <SignInCard />
      </div>
    );
  }
  if (me.active_league_id === null) return <NeedsLeagueCard />;
  const season = safeLatestSeason(seasons);

  return (
    <div className="flex flex-col gap-4">
      <LeagueSubNav active="bracket" awardsHref={awardsHrefFor(season)} activeLeagueName={activeLeagueName} />
      <div>
        <h1 className="text-2xl font-semibold">Playoff Bracket</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          The top seeds play for the title; everyone else plays down the ladder, and two of them end up in the Toilet Bowl.
        </p>
      </div>
      {season === null ? (
        <p className="text-sm text-black/50 dark:text-white/50">No season yet.</p>
      ) : (
        <BracketExperience season={season} myOwnerId={me.owner_id} initialMode={mode} initialW={w} />
      )}
    </div>
  );
}
