import Link from "next/link";

/**
 * Shown on any league-browse page (Standings, Rivalries, Power
 * Rankings, Records, Matchups, Team/Owner detail, Chug, Awards) when
 * the signed-in visitor isn't a real member of the league whose data
 * that page would otherwise show — every one of those backend routes
 * now requires real active-league membership (require_league_access,
 * 2026-09 audit: this data used to be fully public, readable by any
 * signed-in account regardless of membership). Distinct from
 * SignInCard, which is for "not signed in at all" — this is
 * specifically "signed in, but nothing to show here yet."
 */
export function NeedsLeagueCard() {
  return (
    <div className="flex justify-center py-6">
      <div
        className="neon-panel flex w-full max-w-sm flex-col items-center gap-2 rounded-2xl p-8 text-center"
        style={{ background: "var(--wl-surface)", border: "1px solid var(--wl-border)" }}
      >
        <h1 className="font-display text-lg font-semibold text-[color:var(--wl-text)]">
          Join a league to see this
        </h1>
        <p className="text-sm text-[color:var(--wl-text-secondary)]">
          This page only shows a league&apos;s own data to its real members.
        </p>
        <Link
          href="/leagues"
          className="mt-2 rounded-full px-4 py-2 text-sm font-semibold"
          style={{ background: "var(--user-accent, var(--wl-accent))", color: "#06110a" }}
        >
          Join or create a league
        </Link>
      </div>
    </div>
  );
}
