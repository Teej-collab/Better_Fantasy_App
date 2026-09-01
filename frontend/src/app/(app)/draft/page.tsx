import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getMe, listSeasons, listTeams, safeLatestSeason } from "@/lib/api";
import { getDraftPoolServer, getDraftStateServer } from "@/lib/draftApi";
import { DraftRoom } from "@/components/draft/DraftRoom";
import { MyTeamSubNav } from "@/components/nav/MyTeamSubNav";
import { SignInCard } from "@/components/SignInCard";

export const metadata: Metadata = { title: "Draft — Weekend League" };

export default async function DraftPage() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session")?.value;
  const me = await getMe(sessionCookie);

  if (!me) {
    return (
      <div className="flex flex-col gap-4">
        <MyTeamSubNav active="draft" />
        <div className="flex justify-center py-6">
          <SignInCard />
        </div>
      </div>
    );
  }

  // The active season for the team list isn't known until draftState
  // loads client-side (chicken-and-egg for the "no draft yet" setup
  // case) — same reasoning DraftRoom's own client fetch used to rely on,
  // just resolved server-side now: listSeasons() returns every season
  // with a synced teams_by_season row, so the highest one is the
  // current one (safeLatestSeason, not a bare Math.max — see its doc).
  const [draftState, pool, { seasons }] = await Promise.all([
    getDraftStateServer(sessionCookie),
    getDraftPoolServer(sessionCookie),
    listSeasons(),
  ]);
  const latestSeason = safeLatestSeason(seasons);
  const teams = latestSeason !== null ? (await listTeams(latestSeason)).teams : [];

  return (
    <div className="flex flex-col gap-4">
      <MyTeamSubNav active="draft" />
      <h1 className="text-2xl font-semibold">Draft</h1>
      <DraftRoom
        myOwnerId={me.owner_id}
        isCommissioner={me.is_commissioner}
        initialDraftState={draftState}
        initialPool={pool}
        initialTeams={teams}
      />
    </div>
  );
}
