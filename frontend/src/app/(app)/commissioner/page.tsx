import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { getMe, getMyPreferences } from "@/lib/api";
import { SignInCard } from "@/components/SignInCard";
import { NeedsLeagueCard } from "@/components/NeedsLeagueCard";
import { NAV_ACCENT } from "@/lib/navDestinations";
import { panelGlowStyle } from "@/lib/sectionColors";

export const metadata: Metadata = { title: "Commissioner Tools — Weekend League" };

/**
 * A hub, not a mega-page — same pattern as /history (see that page's
 * own docstring): each card below links to its own focused,
 * independently-gated destination instead of one long scrolling page
 * of unrelated sections. Redesigned 2026-09-03 from a single-page
 * CommissionerApp (now deleted) into this shape, both to match the
 * app's own established IA and to make room for the several new
 * commissioner tools added the same day (Keeper Rules, roster slot
 * shape, force-edit a member's roster, add-team-for-member, playoff
 * settings, League Manager Polls) without one page growing unbounded.
 * Draft's own tile links straight to /draft — its commissioner setup
 * controls (DraftSetupPanel) already live there, not here.
 */
export default async function CommissionerPage() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session")?.value;
  const [me, myPreferences] = await Promise.all([getMe(sessionCookie), getMyPreferences(sessionCookie)]);
  const betaLayout = Boolean(myPreferences?.beta_layout);

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

  const tiles: { href: string; title: string; description: string }[] = [
    {
      href: "/commissioner/league",
      title: "League Settings",
      description: "Rename your league, copy the invite code, and set your playoff format",
    },
    {
      href: "/commissioner/scoring",
      title: "Scoring Rules",
      description: "Points per stat, grouped by category — changes apply immediately",
    },
    {
      href: "/commissioner/members",
      title: "Members",
      description: "Promote, demote, or remove a member from your league",
    },
    {
      href: "/commissioner/teams",
      title: "Teams",
      description: "Reassign a team to a different member, or add a new team",
    },
    {
      href: "/commissioner/roster",
      title: "Roster & Keepers",
      description: "Roster slot shape, keeper rules, and force-editing a member's roster",
    },
    {
      href: "/draft",
      title: "Draft",
      description: "Setup, order, schedule, and live draft-room controls",
    },
    {
      href: "/commissioner/trades",
      title: "Trades",
      description: "Trade deadline, review requirement, and pending trades to approve",
    },
    {
      href: "/commissioner/polls",
      title: "Polls",
      description: "Ask your league a question and collect votes",
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Commissioner Tools</h1>
        <p className="text-sm text-black/60 dark:text-white/60">Everything you can manage for your league.</p>
      </div>

      {/* Flat under the beta layout — Documentation/UX/00_UX_Audit.md's
          Commissioner finding was that nothing here visually signals
          "you're in an admin tool," since every tile shared the exact
          same rotating-glow treatment as fan-facing content. Legacy
          rendering (.neon-panel + panelGlowStyle) is unchanged. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((tile) => (
          <Link
            key={tile.href}
            href={tile.href}
            className={
              betaLayout
                ? "wl-card flex flex-col gap-1 rounded-xl p-4 transition-colors hover:bg-black/5 active:bg-black/10 dark:hover:bg-white/5 dark:active:bg-white/10"
                : "neon-panel flex flex-col gap-1 rounded-xl bg-black/[0.015] p-4 transition-all hover:bg-black/5 active:scale-[0.98] active:bg-black/10 dark:bg-white/[0.03] dark:hover:bg-white/5 dark:active:bg-white/10"
            }
            style={betaLayout ? undefined : panelGlowStyle(NAV_ACCENT)}
          >
            <span className="flex items-center gap-1.5 font-medium">
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: NAV_ACCENT, boxShadow: betaLayout ? undefined : `0 0 5px ${NAV_ACCENT}` }}
                aria-hidden
              />
              {tile.title}
            </span>
            <span className="text-sm text-black/50 dark:text-white/50">{tile.description}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
