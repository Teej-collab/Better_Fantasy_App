// Fixed color per roster position for the draft board (DraftRoom.tsx,
// DraftBoard.tsx) — same idea as Sleeper's own draft UI, where a
// player's position is always visually distinguishable at a glance
// without reading the text. A fixed palette (not derived from
// DESTINATIONS or NEON_PALETTE, both different concerns — nav-tab
// identity and the owner's personal accent color, respectively) since
// these six values need to work well as a small set shown side by
// side in a dense list, not picked individually.
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
  return POSITION_COLORS[IDP_GROUP[position] ?? position] ?? FALLBACK_COLOR;
}
