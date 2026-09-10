import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getActiveLeagueName, getMe, getMyPreferences, getSeasonDraft, listSeasons } from "@/lib/api";
import type { DraftConfig, DraftPick } from "@/lib/draftApi";
import { DraftGradesView } from "@/components/draft/DraftGradesView";
import { LeagueSubNav } from "@/components/nav/LeagueSubNav";
import { NeedsLeagueCard } from "@/components/NeedsLeagueCard";
import { SeasonTabs } from "@/components/nav/SeasonTabs";
import { SignInCard } from "@/components/SignInCard";
import { BackButton } from "@/components/BackButton";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ season: string }>;
}): Promise<Metadata> {
  const { season } = await params;
  return { title: `${season} Draft — Weekend League` };
}

export default async function SeasonDraftPage({
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

  const [{ seasons }, draft, myPreferences, activeLeagueName] = await Promise.all([
    listSeasons(),
    getSeasonDraft(Number(season), sessionCookie),
    getMyPreferences(sessionCookie),
    getActiveLeagueName(sessionCookie),
  ]);
  if (!draft) notFound();

  return (
    <div className="flex flex-col gap-4">
      <BackButton fallbackHref="/history" label="History" />
      <LeagueSubNav active="history" awardsHref={`/seasons/${season}/awards`} activeLeagueName={activeLeagueName} />
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h1 className="text-2xl font-semibold">Draft</h1>
        <SeasonTabs seasons={seasons} activeSeason={season} hrefFor={(s) => `/seasons/${s}/draft`} />
      </div>

      {draft.grades.length === 0 ? (
        <p className="text-sm text-black/50 dark:text-white/50">
          Draft grades haven&apos;t been computed for {season} yet — they appear automatically shortly
          after the real draft finishes.
        </p>
      ) : null}

      <DraftGradesView
        config={draft.config as unknown as DraftConfig}
        picks={draft.picks as unknown as DraftPick[]}
        grades={draft.grades}
        narratives={draft.narratives}
        beta={Boolean(myPreferences?.beta_layout)}
      />
    </div>
  );
}
