import type { TeamTouchdown } from "@/lib/api";

// Real touchdowns scored by each side's active starters this week (see
// backend's queries.get_touchdowns_for_teams). Always renders, labeled
// — this used to return null entirely pre-kickoff, which read as a
// mystery unlabeled empty box rather than "no touchdowns yet" (2026-09
// reported, easy to confuse with a nearby unrelated panel that really
// was rendering empty — see matchups/[matchupId]/page.tsx's
// TeamDetailSummary fix from the same report).
export function MyTouchdownsSection({
  homeName,
  awayName,
  homeTouchdowns,
  awayTouchdowns,
}: {
  homeName: string;
  awayName: string;
  homeTouchdowns: TeamTouchdown[];
  awayTouchdowns: TeamTouchdown[];
}) {
  return (
    <div className="neon-panel rounded-lg p-4">
      <h2 className="mb-3 text-sm font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
        Touchdowns
      </h2>
      <div className="grid grid-cols-2 gap-4 text-sm">
        <TouchdownList teamName={homeName} touchdowns={homeTouchdowns} />
        <TouchdownList teamName={awayName} touchdowns={awayTouchdowns} align="right" />
      </div>
    </div>
  );
}

function TouchdownList({
  teamName,
  touchdowns,
  align = "left",
}: {
  teamName: string;
  touchdowns: TeamTouchdown[];
  align?: "left" | "right";
}) {
  return (
    <div className={`flex flex-col gap-1 ${align === "right" ? "items-end text-right" : "items-start text-left"}`}>
      <span className="text-xs text-black/50 dark:text-white/50">{teamName}</span>
      {touchdowns.length === 0 ? (
        <span className="text-black/40 dark:text-white/40">No touchdowns yet</span>
      ) : (
        touchdowns.map((td) => (
          <span key={td.player_name}>
            {"\u{1F3C8}"} {td.player_name}
            {td.touchdowns > 1 && ` ×${td.touchdowns}`}
          </span>
        ))
      )}
    </div>
  );
}
