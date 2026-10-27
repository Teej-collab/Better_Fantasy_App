import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getMe } from "@/lib/api";
import { MyTeamSubNav } from "@/components/nav/MyTeamSubNav";
import { NeedsLeagueCard } from "@/components/NeedsLeagueCard";
import { SignInCard } from "@/components/SignInCard";
import { WarRoom } from "@/components/warRoom/WarRoom";

export const metadata: Metadata = { title: "War Room — The Weekend" };

// My Team's Draft and Keepers tabs as one (2026-10-27). The live draft
// room itself stays at /draft, one tap away.
export default async function WarRoomPage() {
  const cookieStore = await cookies();
  const me = await getMe(cookieStore.get("session")?.value);

  return (
    <div className="flex flex-col gap-4">
      <MyTeamSubNav active="warRoom" />
      <h1 className="text-2xl font-semibold">War Room</h1>
      {!me ? (
        <div className="flex justify-center py-6">
          <SignInCard />
        </div>
      ) : me.active_league_id === null ? (
        <NeedsLeagueCard />
      ) : (
        <WarRoom isCommissioner={me.is_commissioner} />
      )}
    </div>
  );
}
