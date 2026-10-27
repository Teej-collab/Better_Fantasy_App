import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getMe } from "@/lib/api";
import { SignInCard } from "@/components/SignInCard";
import { NeedsLeagueCard } from "@/components/NeedsLeagueCard";
import { BackButton } from "@/components/BackButton";
import { RivalrySuggestionsSection } from "@/components/commissioner/RivalrySuggestionsSection";

export const metadata: Metadata = { title: "Rivalries — The Weekend" };

export default async function CommissionerRivalriesPage() {
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
    <div className="flex flex-col gap-4">
      <BackButton fallbackHref="/commissioner" label="Commissioner Tools" />
      <div>
        <h1 className="text-2xl font-semibold">Rivalries</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          Pairs your league&apos;s history says have real beef. Make one official and it shows on the Rivalries page
          and in their matchups.
        </p>
      </div>
      <RivalrySuggestionsSection />
    </div>
  );
}
