import type { CSSProperties } from "react";
import { NAV_ACCENT } from "@/lib/navDestinations";

// Every content panel's glow (globals.css's --panel-glow) used to reuse
// that section's own distinct hue from lib/navDestinations.ts — a
// different color per topic (Standings sky blue, Matchups pink, Chug
// amber, etc.). Collapsed to the single app accent (NAV_ACCENT — same
// constant the nav bar itself now reads, see navDestinations.ts) on
// 2026-08-31, per the owner's own request: every one of these was
// still a panel getting its own persistent color even after the glow
// intensity itself was dampened, which read as "many things ask for
// attention" rather than "one calm surface, one accent." A page/
// component with no key at all here already fell through to
// --user-accent anyway (see .neon-panel in globals.css), so this just
// makes every section agree with that same default instead of
// special-casing itself away from it.
export const SECTION_COLORS: Record<string, string> = {
  standings: NAV_ACCENT,
  matchups: NAV_ACCENT,
  awards: NAV_ACCENT,
  rivalries: NAV_ACCENT,
  playerCards: NAV_ACCENT,
  freeAgents: NAV_ACCENT,
  rules: NAV_ACCENT,
  league: NAV_ACCENT,
  chug: NAV_ACCENT,
  chat: NAV_ACCENT,
  powerRankings: NAV_ACCENT,
  gamecast: NAV_ACCENT,
};

// CSS custom properties don't have a first-class React prop — every
// caller that wants a section-colored glow spreads this into its
// className's element as `style`.
export function panelGlowStyle(color: string | undefined): CSSProperties | undefined {
  if (!color) return undefined;
  return { ["--panel-glow" as string]: color } as CSSProperties;
}
