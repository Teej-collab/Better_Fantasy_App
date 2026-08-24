import type { CSSProperties } from "react";

// One color per league "section" — the single source of truth reused
// for the homepage's section-header dots, the League sub-nav tabs, and
// every content panel's glow (globals.css's --panel-glow). A page/
// component belonging to one of these topics passes its hex through;
// anything without an established topic (My Team, Settings, sign-in
// gate cards) leaves the panel on the default (--user-accent, the
// owner's own chosen color — see AppearanceSection.tsx).
export const SECTION_COLORS: Record<string, string> = {
  standings: "#0ea5e9",
  matchups: "#ec4899",
  awards: "#fbbf24",
  rivalries: "#f97316",
  players: "#22d3ee",
  rules: "#a855f7",
  league: "#6366f1",
  chug: "#d97706",
  chat: "#84cc16",
};

// CSS custom properties don't have a first-class React prop — every
// caller that wants a section-colored glow spreads this into its
// className's element as `style`.
export function panelGlowStyle(color: string | undefined): CSSProperties | undefined {
  if (!color) return undefined;
  return { ["--panel-glow" as string]: color } as CSSProperties;
}
