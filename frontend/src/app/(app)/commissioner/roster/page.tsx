import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getMe } from "@/lib/api";
import { SignInCard } from "@/components/SignInCard";
import { NeedsLeagueCard } from "@/components/NeedsLeagueCard";
import { BackButton } from "@/components/BackButton";
import { KeeperRulesSection } from "@/components/commissioner/KeeperRulesSection";
import { RosterSlotsSection } from "@/components/commissioner/RosterSlotsSection";
import { ForceEditRosterSection } from "@/components/commissioner/ForceEditRosterSection";

export const metadata: Metadata = { title: "Roster & Keepers — Weekend League" };

export default async function CommissionerRosterPage() {
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
  if (!me.is_commissioner) {
    return (
      <p className="py-12 text-center text-sm text-black/50 dark:text-white/50">
        Commissioner tools are only visible to your league&apos;s commissioner.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <BackButton fallbackHref="/commissioner" label="Commissioner Tools" />
      <h1 className="text-2xl font-semibold">Roster & Keepers</h1>
      <KeeperRulesSection />
      <RosterSlotsSection />
      <ForceEditRosterSection />
    </div>
  );
}
