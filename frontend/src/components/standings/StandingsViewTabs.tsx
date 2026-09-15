"use client";

import { useState, type ReactNode } from "react";

const TABS = ["Standings", "Scoreboard", "Playoffs"] as const;
type Tab = (typeof TABS)[number];

// Real ESPN League tab's own segmented control (reference video,
// 2026-09-15) — plain client-side show/hide, not URL-driven, since
// which of these three someone's looking at isn't something worth a
// real navigation or a bookmarkable state. All three panels' data is
// already fetched server-side up front (each is cheap — this league's
// own already-computed standings/current week's matchups/bracket), so
// switching tabs is instant with no loading state of its own.
export function StandingsViewTabs({
  standings,
  scoreboard,
  playoffs,
}: {
  standings: ReactNode;
  scoreboard: ReactNode;
  playoffs: ReactNode | null;
}) {
  const [active, setActive] = useState<Tab>("Standings");
  const tabs = playoffs !== null ? TABS : TABS.filter((t) => t !== "Playoffs");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-1 rounded-full bg-black/[0.04] p-1 dark:bg-white/[0.06]">
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActive(tab)}
            className={
              "flex-1 rounded-full px-3 py-1.5 text-sm font-medium transition-colors " +
              (active === tab
                ? "bg-white text-black shadow-sm dark:bg-white/15 dark:text-white"
                : "text-black/50 hover:text-black dark:text-white/50 dark:hover:text-white")
            }
          >
            {tab}
          </button>
        ))}
      </div>

      {active === "Standings" && standings}
      {active === "Scoreboard" && scoreboard}
      {active === "Playoffs" && playoffs}
    </div>
  );
}
