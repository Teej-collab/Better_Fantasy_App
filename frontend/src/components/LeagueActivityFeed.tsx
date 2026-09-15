import Link from "next/link";
import type { LeagueActivityItem, LeagueActivityRosterItem, LeagueActivityTradeItem } from "@/lib/api";
import { relativeTime } from "@/lib/adminFormat";
import { SECTION_COLORS, panelGlowStyle } from "@/lib/sectionColors";

const SOURCE_ICON: Record<LeagueActivityRosterItem["source"], string> = {
  free_agent: "➕",
  waiver: "🎯",
  commissioner: "🛠️",
};

function rosterSummary(item: LeagueActivityRosterItem): string {
  if (item.added_player_name && item.dropped_player_name) {
    return `added ${item.added_player_name}, dropped ${item.dropped_player_name}`;
  }
  if (item.added_player_name) return `added ${item.added_player_name}`;
  return `dropped ${item.dropped_player_name}`;
}

function RosterRow({ item }: { item: LeagueActivityRosterItem }) {
  return (
    <li className="flex items-start justify-between gap-3 px-4 py-3 text-sm">
      <span className="flex min-w-0 items-start gap-2">
        <span className="shrink-0" aria-hidden>
          {SOURCE_ICON[item.source]}
        </span>
        <span className="flex min-w-0 flex-col">
          <span>
            <Link href={`/owners/${item.owner_id}`} className="font-medium hover:underline">
              {item.owner_name}
            </Link>{" "}
            <span className="text-black/70 dark:text-white/70">{rosterSummary(item)}</span>
          </span>
          <span className="truncate text-xs text-black/50 dark:text-white/50">{item.team_name}</span>
        </span>
      </span>
      <span className="shrink-0 text-xs whitespace-nowrap text-black/40 dark:text-white/40">
        {relativeTime(item.timestamp)}
      </span>
    </li>
  );
}

function TradeRow({ item }: { item: LeagueActivityTradeItem }) {
  return (
    <li className="flex items-start justify-between gap-3 px-4 py-3 text-sm">
      <span className="flex min-w-0 items-start gap-2">
        <span className="shrink-0" aria-hidden>
          🔁
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span>
            <Link href={`/owners/${item.proposing_owner_id}`} className="font-medium hover:underline">
              {item.proposing_owner_name}
            </Link>{" "}
            <span className="text-black/70 dark:text-white/70">traded with</span>{" "}
            <Link href={`/owners/${item.receiving_owner_id}`} className="font-medium hover:underline">
              {item.receiving_owner_name}
            </Link>
          </span>
          <span className="text-xs text-black/50 dark:text-white/50">
            {item.assets.map((a) => a.player_name).join(", ")}
          </span>
        </span>
      </span>
      <span className="shrink-0 text-xs whitespace-nowrap text-black/40 dark:text-white/40">
        {relativeTime(item.timestamp)}
      </span>
    </li>
  );
}

// League Activity — trades, waiver pickups, and free-agent adds/drops,
// merged server-side (app/domain/league_activity.py) into one
// reverse-chronological feed (2026-09-15 ask). Same shared-component
// pattern as ChugFeed.tsx: rendered on the homepage (capped) and on its
// own full page (/activity, uncapped-ish) from the same component,
// with whatever `limit` the caller fetched already baked into `items`.
export function LeagueActivityFeed({ items, href }: { items: LeagueActivityItem[]; href?: string }) {
  if (items.length === 0) return null;

  const heading = href ? (
    <Link href={href} className="flex items-center gap-2 hover:underline">
      <h2 className="text-lg font-semibold">League Activity</h2>
    </Link>
  ) : (
    <h2 className="text-lg font-semibold">League Activity</h2>
  );

  return (
    <div className="flex flex-col gap-2">
      {heading}
      <ol
        className="neon-panel flex flex-col divide-y divide-black/5 rounded-lg bg-black/[0.015] dark:divide-white/5 dark:bg-white/[0.03]"
        style={panelGlowStyle(SECTION_COLORS.activity)}
      >
        {items.map((item, i) =>
          item.kind === "roster" ? (
            <RosterRow key={`roster-${item.timestamp}-${i}`} item={item} />
          ) : (
            <TradeRow key={`trade-${item.timestamp}-${i}`} item={item} />
          )
        )}
      </ol>
    </div>
  );
}
