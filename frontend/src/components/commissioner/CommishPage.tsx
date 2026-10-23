import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { getMe } from "@/lib/api";
import { SignInCard } from "@/components/SignInCard";
import { NeedsLeagueCard } from "@/components/NeedsLeagueCard";
import { BackButton } from "@/components/BackButton";

/**
 * The frame every Commissioner Tools page shares (2026-10-23 overhaul):
 * signed in, in a league, and that league's commissioner, or a note
 * saying why not; then a back link to the hub and the page's title.
 */
export async function CommishPage({ title, subtitle, children, back = true }: { title: string; subtitle?: string; children: ReactNode; back?: boolean }) {
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
  if (!me.is_commissioner) {
    return (
      <p className="py-12 text-center text-sm text-black/50 dark:text-white/50">
        Commissioner tools are only visible to your league&apos;s commissioner.
      </p>
    );
  }
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      {back && <BackButton fallbackHref="/commissioner" label="Commissioner" />}
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-3xl font-semibold tracking-wide uppercase">{title}</h1>
        {subtitle && <p className="text-sm text-black/60 dark:text-white/60">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}
