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

// One color per tab from the app's shared 7-color neon palette (lib/
// neonPalette.ts) — matches each tab's own established section color
// where one already exists (Standings/Rivalries/Rules/Chug's box glow,
// sectionColors.ts) so the tab and its page agree.
const TAB_COLOR: Record<LeagueTab, string> = {
  overview: "#39ff14", // Neon Green
  standings: "#0ea5e9", // Neon Blue
  playerCards: "#22d3ee", // Neon Lightning Blue
  awards: "#facc15", // Neon Yellow
  rivalries: "#f97316", // Neon Orange
  rules: "#a855f7", // Neon Purple
  chug: "#ec4899", // Neon Pink
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
            className="neon-navlink shrink-0 rounded-full px-3 py-1.5 text-sm font-medium text-black/60 dark:text-white/60"
            style={{ ["--nav-color" as string]: TAB_COLOR[tab.key] }}
          >
            {LABELS[tab.key]}
          </a>
        ))}
      </nav>
    </div>
  );
}
