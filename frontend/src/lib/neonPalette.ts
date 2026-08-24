// The app's 7-color neon palette — shared by the Accent Color picker
// (AppearanceSection.tsx, drives --user-accent) and the primary/League
// sub-nav tab colors (PrimaryNav.tsx, BottomNav.tsx, LeagueSubNav.tsx).
// One named list so a color always means the same hex everywhere it
// shows up in the app, not a slightly different shade per component.
export const NEON_PALETTE: { name: string; hex: string }[] = [
  { name: "Neon Green", hex: "#39ff14" },
  { name: "Neon Blue", hex: "#0ea5e9" },
  { name: "Neon Pink", hex: "#ec4899" },
  { name: "Neon Yellow", hex: "#facc15" },
  { name: "Neon Orange", hex: "#f97316" },
  { name: "Neon Lightning Blue", hex: "#22d3ee" },
  { name: "Neon Purple", hex: "#a855f7" },
];
