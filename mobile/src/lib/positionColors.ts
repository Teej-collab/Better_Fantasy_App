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
  // IDP leagues (2026-10): individual defenders by group.
  DL: "#f472b6",
  LB: "#2dd4bf",
  DB: "#a3e635",
};

// Sleeper's raw defensive positions -> the IDP group whose color they wear.
const IDP_GROUP: Record<string, string> = {
  DE: "DL", DT: "DL", NT: "DL", ILB: "LB", OLB: "LB", MLB: "LB", CB: "DB", S: "DB", SS: "DB", FS: "DB",
};

const FALLBACK_COLOR = "#9ca3af";

export function positionColor(position: string | null | undefined): string {
  if (!position) return FALLBACK_COLOR;
  // Some feeds say "D/ST" for a defense.
  return (
    POSITION_COLORS[position === "D/ST" ? "DEF" : (IDP_GROUP[position] ?? position)] ?? FALLBACK_COLOR
  );
}
