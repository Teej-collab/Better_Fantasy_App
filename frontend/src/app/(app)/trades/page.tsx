import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getMe } from "@/lib/api";
import { MyTeamSubNav } from "@/components/nav/MyTeamSubNav";
import { SignInCard } from "@/components/SignInCard";
import { NeedsLeagueCard } from "@/components/NeedsLeagueCard";
import { TradesApp } from "@/components/TradesApp";

export const metadata: Metadata = { title: "Trades — The Weekend" };

export default async function TradesPage({
  searchParams,
}: {
  searchParams: Promise<{ team?: string; player?: string }>;
}) {
  // From a player's "Trade" button (2026-10): their team and them, picked.
  const { team, player } = await searchParams;
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session")?.value;
  const me = await getMe(sessionCookie);

  if (!me) {
    return (
      <div className="flex flex-col gap-4">
        <MyTeamSubNav active="trades" />
        <div className="flex justify-center py-6">
          <SignInCard />
        </div>
      </div>
    );
  }
  if (me.active_league_id === null) {
    return (
      <div className="flex flex-col gap-4">
        <MyTeamSubNav active="trades" />
        <NeedsLeagueCard />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <MyTeamSubNav active="trades" />
      <h1 className="text-2xl font-semibold">Trades</h1>
      <TradesApp initialTeamId={team ? Number(team) || null : null} initialPlayerId={player ?? null} />
    </div>
  );
}
