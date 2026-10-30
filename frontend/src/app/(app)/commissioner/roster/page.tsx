import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getMe } from "@/lib/api";
import { SignInCard } from "@/components/SignInCard";
import { NeedsLeagueCard } from "@/components/NeedsLeagueCard";
import { BackButton } from "@/components/BackButton";
import { KeeperVault, RosterHiveBuilder } from "@/components/commissioner/RosterHiveBuilder";
import Link from "next/link";

export const metadata: Metadata = { title: "Roster & Keepers — The Weekend" };

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
      <div className="mx-auto flex w-full max-w-xl flex-col gap-8 rounded-3xl bg-[radial-gradient(90%_30%_at_50%_10%,rgba(57,255,20,.08),transparent_70%),#0d1016] p-4 text-[#f5f4ec] sm:p-6">
        <h1 className="sr-only">Roster & Keepers</h1>
        <RosterHiveBuilder />
        <KeeperVault />
        <Link href="/commissioner/lineup" className="rounded-2xl border border-white/[0.07] bg-[#141a22] px-4 py-3.5 text-sm">
          <span className="font-semibold">Fix a lineup</span>
          <span className="block text-[#f5f4ec]/60">Move, add or drop for any team</span>
        </Link>
      </div>
    </div>
  );
}
