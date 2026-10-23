import { router, type Href } from 'expo-router';

// "Propose a trade for this player" (2026-10): the trade builder opened on
// their team with them already picked (app/trade-builder.tsx reads team/player).
export function proposeTradeFor(p: { rostered_team_id?: number | null; sleeper_player_id: string }): void {
  if (p.rostered_team_id == null) return;
  router.push(`/trade-builder?team=${p.rostered_team_id}&player=${encodeURIComponent(p.sleeper_player_id)}` as Href);
}
