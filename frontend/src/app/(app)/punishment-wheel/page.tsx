import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getMe } from "@/lib/api";
import { SignInCard } from "@/components/SignInCard";
import { NeedsLeagueCard } from "@/components/NeedsLeagueCard";
import { BackButton } from "@/components/BackButton";
import { PunishmentWheel } from "@/components/PunishmentWheel";

export const metadata: Metadata = { title: "Punishment Wheel — The Weekend" };

// Every member can watch the wheel; commissioners and admins fill it, and
// a commissioner spins it once a season (components/PunishmentWheel.tsx).
export default async function PunishmentWheelPage() {
  const cookieStore = await cookies();
  const me = await getMe(cookieStore.get("session")?.value);
  if (!me) {
    return (
      <div className="flex justify-center py-6">
        <SignInCard />
      </div>
    );
  }
  if (me.active_league_id === null) return <NeedsLeagueCard />;
  return (
    <div className="flex flex-col gap-4">
      <BackButton fallbackHref="/commissioner" label="Back" />
      <PunishmentWheel leagueId={me.active_league_id} />
    </div>
  );
}
