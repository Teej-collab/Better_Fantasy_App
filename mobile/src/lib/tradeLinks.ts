import { router } from 'expo-router';

// "Propose a trade for this player" (2026-10): the trade screen opened on
// their team with them already picked (app/trades.tsx reads team/player).
export function proposeTradeFor(p: { rostered_team_id?: number | null; sleeper_player_id: string }): void {
  if (p.rostered_team_id == null) return;
  router.push({ pathname: '/trades', params: { team: String(p.rostered_team_id), player: p.sleeper_player_id } });
}
