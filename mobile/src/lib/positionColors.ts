// A fixed color per position, the same as the web's
// (frontend/src/lib/positionColors.ts) — keep the two in step. Shown as
// a thin stripe beside each player row (lineup, matchup, free agents,
// draft, trades) so a position reads at a glance without the text.
export const POSITION_COLORS: Record<string, string> = {
  QB: "#f87171",
  RB: "#4ade80",
  WR: "#38bdf8",
  TE: "#fb923c",
  K: "#c084fc",
  DEF: "#facc15",
};

const FALLBACK_COLOR = "#9ca3af";

export function positionColor(position: string | null | undefined): string {
  if (!position) return FALLBACK_COLOR;
  // Some feeds say "D/ST" for a defense.
  return (
    POSITION_COLORS[position === "D/ST" ? "DEF" : position] ?? FALLBACK_COLOR
  );
}
