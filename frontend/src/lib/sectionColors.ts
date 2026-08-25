import type { CSSProperties } from "react";
import { DESTINATIONS } from "@/lib/navDestinations";

// One color per league "section" — every content panel's glow
// (globals.css's --panel-glow) reuses whatever color that section's
// nav tab already uses, derived from lib/navDestinations.ts (the single
// source every nav surface also reads from) so a page and its own nav
// tab can never drift apart the way they used to. A page/component
// belonging to one of these topics passes its hex through; anything
// without an established topic (My Team, Settings, sign-in gate cards)
// leaves the panel on the default (--user-accent, the owner's own
// chosen color — see AppearanceSection.tsx).
export const SECTION_COLORS: Record<string, string> = {
  standings: DESTINATIONS.standings.color,
  matchups: DESTINATIONS.matchups.color,
  awards: DESTINATIONS.awards.color,
  rivalries: DESTINATIONS.rivalries.color,
  playerCards: DESTINATIONS.playerCards.color,
  freeAgents: DESTINATIONS.freeAgents.color,
  rules: DESTINATIONS.rules.color,
  league: DESTINATIONS.league.color,
  chug: DESTINATIONS.chug.color,
  chat: DESTINATIONS.chat.color,
};

// CSS custom properties don't have a first-class React prop — every
// caller that wants a section-colored glow spreads this into its
// className's element as `style`.
export function panelGlowStyle(color: string | undefined): CSSProperties | undefined {
  if (!color) return undefined;
  return { ["--panel-glow" as string]: color } as CSSProperties;
}
