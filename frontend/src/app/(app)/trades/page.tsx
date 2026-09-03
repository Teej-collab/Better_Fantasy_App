import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getMe } from "@/lib/api";
import { MyTeamSubNav } from "@/components/nav/MyTeamSubNav";
import { SignInCard } from "@/components/SignInCard";
import { NeedsLeagueCard } from "@/components/NeedsLeagueCard";
import { TradesApp } from "@/components/TradesApp";

export const metadata: Metadata = { title: "Trades — Weekend League" };

export default async function TradesPage() {
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
      <TradesApp />
    </div>
  );
}
