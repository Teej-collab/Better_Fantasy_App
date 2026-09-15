import type { CSSProperties } from "react";
import { DESTINATIONS } from "@/lib/navDestinations";

// Every content panel's ring color (globals.css's --panel-glow-cosmic)
// reuses that section's own distinct hue from lib/navDestinations.ts —
// a different color per topic (Standings sky blue, Matchups pink, Chug
// amber, etc.), same values the nav bar's own Cosmic tab colors
// already use. Collapsed to a single flat app accent on 2026-08-31 to
// calm the app down (every value here was NAV_ACCENT); restored 2026-09
// per a later owner request to bring per-section color back — but
// Cosmic-only this time (globals.css's [data-wl-theme="cosmic"]
// .neon-panel rule is the only place that reads what panelGlowStyle
// sets below), so Calm still stays the flat, single-accent look the
// 2026-08-31 change was actually about. A page/component with no key
// at all here still falls through to the owner's own Border Animation
// Color (then Accent Color) — see .neon-panel in globals.css.
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
  powerRankings: DESTINATIONS.powerRankings.color,
  gamecast: DESTINATIONS.gamecast.color,
  draft: DESTINATIONS.draft.color,
  activity: DESTINATIONS.activity.color,
};

// CSS custom properties don't have a first-class React prop — every
// caller that wants a section-colored ring spreads this into its
// className's element as `style`. Sets --panel-glow-cosmic
// unconditionally, exactly like every nav component already sets
// --nav-color-cosmic unconditionally — cheap to set even in Calm,
// where nothing reads it (globals.css's Cosmic-only rule is what
// decides whether it matters), and it has to be a DIFFERENT property
// than whatever a stylesheet rule might reassign, per the same
// inline-style-always-wins reasoning --nav-color-cosmic's own comment
// documents.
export function panelGlowStyle(color: string | undefined): CSSProperties | undefined {
  if (!color) return undefined;
  return { ["--panel-glow-cosmic" as string]: color } as CSSProperties;
}
