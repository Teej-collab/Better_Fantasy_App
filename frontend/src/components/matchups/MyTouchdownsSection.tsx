import type { TeamTouchdown } from "@/lib/api";

// Real touchdowns scored by each side's active starters this week (see
// backend's queries.get_touchdowns_for_teams) — both lists are simply
// empty before any real games have been played, the same honest zero
// as every other live number on this page pre-kickoff, so the section
// itself just doesn't render rather than showing an empty shell.
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
  if (homeTouchdowns.length === 0 && awayTouchdowns.length === 0) return null;

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
        <span className="text-black/40 dark:text-white/40">—</span>
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
