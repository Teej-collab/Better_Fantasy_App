export type LeagueTab = "overview" | "standings" | "playerCards" | "awards" | "rivalries" | "rules" | "chug";

const LABELS: Record<LeagueTab, string> = {
  overview: "Overview",
  standings: "Standings",
  playerCards: "Player Cards",
  awards: "Awards",
  rivalries: "Rivalries",
  rules: "Rules",
  chug: "Chug",
};

/**
 * Rendered manually at the top of each League-family page (League,
 * Standings, Player Cards, Awards, Rivalries, Rules, Chug) rather than
 * via a shared route-group layout — keeps this additive (one line per page)
 * instead of restructuring how those routes are organized. No
 * usePathname() needed: each page already knows which tab it is, so
 * `active` is just passed in directly — a plain server component, no
 * client JS for something this simple. `‹ League` only shows on
 * mobile (sm:hidden) — desktop already has "League" one click away in
 * the primary header, this is purely the mobile "how do I get back"
 * affordance from spec §23.
 */
export function LeagueSubNav({ active, awardsHref }: { active: LeagueTab; awardsHref: string }) {
  const tabs: { key: LeagueTab; href: string }[] = [
    { key: "overview", href: "/league" },
    { key: "standings", href: "/standings" },
    { key: "playerCards", href: "/players" },
    { key: "awards", href: awardsHref },
    { key: "rivalries", href: "/rivalries" },
    { key: "rules", href: "/rules" },
    { key: "chug", href: "/chug" },
  ];

  return (
    <div className="mb-4 flex flex-col gap-2">
      <a
        href="/league"
        className="flex w-fit items-center gap-1 text-sm text-black/50 sm:hidden dark:text-white/50"
      >
        ‹ League
      </a>
      <nav
        aria-label="League sections"
        className="flex gap-1 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((tab) => (
          <a
            key={tab.key}
            href={tab.href}
            aria-current={tab.key === active ? "page" : undefined}
            className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
              tab.key === active
                ? "bg-black/[0.06] text-[color:var(--foreground)] dark:bg-white/[0.08]"
                : "text-black/60 hover:bg-black/[0.03] hover:text-black dark:text-white/60 dark:hover:bg-white/[0.04] dark:hover:text-white"
            }`}
          >
            {LABELS[tab.key]}
          </a>
        ))}
      </nav>
    </div>
  );
}
