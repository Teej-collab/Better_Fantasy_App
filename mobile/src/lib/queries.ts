import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { focusManager, QueryClient, useMutation, useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { AppState } from 'react-native';

import { api } from '@/lib/api';
import type { MyTeam, RosterEntry } from '@/lib/types';

// This is the main reason the native app feels faster than the web one:
// every screen renders the last data it saw immediately (saved on the
// phone between launches), then refreshes in the background.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Keep cached data around long enough to survive app restarts.
      gcTime: 1000 * 60 * 60 * 24,
      retry: 1,
    },
  },
});

export const queryPersister = createAsyncStoragePersister({ storage: AsyncStorage });

// React Query only knows about browser tabs out of the box. Tell it when
// the app is on screen, so live refetch timers pause in the background
// (battery) and stale screens refresh the moment you come back.
focusManager.setEventListener((setFocused) => {
  const sub = AppState.addEventListener('change', (state) => setFocused(state === 'active'));
  return () => sub.remove();
});

// While any NFL game is in progress, scores refetch on this beat — the
// same 15 s the web's GameDayRefresher uses for its client data.
const LIVE_REFRESH_MS = 15_000;

export function useNflScoreboard() {
  return useQuery({
    queryKey: ['nfl-scoreboard'],
    queryFn: async () => (await api.nflScoreboard()).games,
    // Faster during games so a kickoff flips everything live quickly.
    refetchInterval: (query) => (query.state.data?.some((g) => g.state === 'in') ? 30_000 : 5 * 60_000),
  });
}

// Same test as the web's isNflGameLive (frontend/src/lib/api.ts).
export function useIsGameLive(): boolean {
  return useNflScoreboard().data?.some((g) => g.state === 'in') ?? false;
}

function useLiveRefetchInterval(): number | false {
  return useIsGameLive() ? LIVE_REFRESH_MS : false;
}

// Latest synced season + its current week. Week is null in preseason;
// ESPN reports 0 then, same fallback to week 1 as the web app's
// resolveWeek (frontend/src/lib/api.ts).
export function useSeasonWeek() {
  return useQuery({
    queryKey: ['season-week'],
    queryFn: async () => {
      const { seasons } = await api.seasons();
      if (seasons.length === 0) return { season: null, week: null };
      const season = Math.max(...seasons);
      const { current_week } = await api.currentWeek(season);
      return { season, week: current_week && current_week >= 1 ? current_week : 1 };
    },
  });
}

export function useMyWeek() {
  const refetchInterval = useLiveRefetchInterval();
  return useQuery({ queryKey: ['my-week'], queryFn: api.myWeek, refetchInterval });
}

export function useMatchupContext(season: number | null, week: number | null) {
  const refetchInterval = useLiveRefetchInterval();
  return useQuery({
    refetchInterval,
    queryKey: ['matchup-context', season, week],
    queryFn: () => api.matchupContext(season!, week!),
    enabled: season !== null && week !== null,
  });
}

export function useStandings(season: number | null) {
  return useQuery({
    queryKey: ['standings', season],
    queryFn: () => api.standings(season!),
    enabled: season !== null,
  });
}

export function useMatchup(matchupId: number) {
  const refetchInterval = useLiveRefetchInterval();
  return useQuery({ queryKey: ['matchup', matchupId], queryFn: () => api.matchup(matchupId), refetchInterval });
}

export function useMyTeam() {
  const refetchInterval = useLiveRefetchInterval();
  return useQuery({ queryKey: ['my-team'], queryFn: api.myTeam, refetchInterval });
}

// A move/swap response leaves every GET /me/team-only field (points,
// matchup, kickoff, projection) empty. Replacing the roster with it
// wholesale blanked all of that on the web (2026-09-23 report), so keep
// each player's full entry and take only the new lineup_slot.
function applyLineupSlots(prev: RosterEntry[], next: RosterEntry[]): RosterEntry[] {
  const prevById = new Map(prev.map((e) => [e.player_id, e]));
  return next.map((e) => {
    const full = prevById.get(e.player_id);
    return full ? { ...full, lineup_slot: e.lineup_slot } : e;
  });
}

export type LineupChange =
  | { kind: 'move'; player: RosterEntry; toSlot: string }
  | { kind: 'swap'; player: RosterEntry; other: RosterEntry };

export function useLineupChange() {
  return useMutation({
    mutationFn: (change: LineupChange) =>
      change.kind === 'move'
        ? api.moveLineup(change.player.player_id, change.toSlot)
        : api.swapLineup(change.player.player_id, change.other.player_id),
    onSuccess: ({ roster }) => {
      queryClient.setQueryData<MyTeam>(['my-team'], (prev) =>
        prev ? { ...prev, roster: applyLineupSlots(prev.roster, roster) } : prev,
      );
      // Starters feed the home card's projections.
      void queryClient.invalidateQueries({ queryKey: ['my-week'] });
    },
  });
}

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: api.me, staleTime: 5 * 60_000 });
}

export function useChatConversations() {
  return useQuery({ queryKey: ['chat-conversations'], queryFn: async () => (await api.chatConversations()).conversations });
}

// The newest page. Older pages are prepended by the chat screen, and
// live messages appended by lib/chatSocket.tsx, both straight into
// this same cache entry.
export function useChatMessages(conversationId: number) {
  return useQuery({
    queryKey: ['chat-messages', conversationId],
    queryFn: async () => (await api.chatMessages(conversationId)).messages,
  });
}

export function useFreeAgents(position: string | undefined, search: string) {
  return useQuery({
    queryKey: ['free-agents', position ?? 'all', search],
    queryFn: async () => (await api.freeAgents(position, search || undefined)).players,
    // Keep the previous list on screen while a new filter loads.
    placeholderData: (previous) => previous,
  });
}

export function useWaiverClaims() {
  return useQuery({ queryKey: ['waiver-claims'], queryFn: async () => (await api.waiverClaims()).claims });
}

// After any add, drop or claim: the roster, the free-agent pool and the
// claim list can all have changed.
export function invalidateRosterMoves() {
  void queryClient.invalidateQueries({ queryKey: ['my-team'] });
  void queryClient.invalidateQueries({ queryKey: ['free-agents'] });
  void queryClient.invalidateQueries({ queryKey: ['waiver-claims'] });
  void queryClient.invalidateQueries({ queryKey: ['my-week'] });
  // Who rosters the player.
  void queryClient.invalidateQueries({ queryKey: ['player-card'] });
}

export function usePlayerCard(sleeperPlayerId: string) {
  return useQuery({ queryKey: ['player-card', sleeperPlayerId], queryFn: () => api.playerCard(sleeperPlayerId) });
}

export function openPlayer(sleeperPlayerId: string | number | null | undefined) {
  if (sleeperPlayerId === null || sleeperPlayerId === undefined) return;
  router.push({ pathname: '/player/[id]', params: { id: String(sleeperPlayerId) } });
}

export function useDraftState(enabled = true) {
  return useQuery({ queryKey: ['draft-state'], queryFn: api.draftState, enabled });
}

export function useDraftPool(position: string | undefined, search: string) {
  return useQuery({
    queryKey: ['draft-pool', position ?? 'all', search],
    queryFn: async () => (await api.draftPool(position, search || undefined)).players,
    placeholderData: (previous) => previous,
  });
}

export function useDraftQueue() {
  return useQuery({ queryKey: ['draft-queue'], queryFn: async () => (await api.draftQueue()).queue });
}

export function useGamecastGames() {
  const live = useIsGameLive();
  return useQuery({
    queryKey: ['gamecast-games'],
    queryFn: async () => (await api.gamecastGames()).games,
    refetchInterval: live ? 60_000 : false,
  });
}

// The Gamecast id for a scoreboard game, matched by team pair — same
// as the web's findGamecastId (frontend/src/lib/gamecastApi.ts).
export function useGamecastIdFinder() {
  const games = useGamecastGames().data ?? [];
  return (home: string | null, away: string | null) =>
    home && away ? (games.find((g) => g.home_team.abbr === home && g.away_team.abbr === away)?.game_id ?? null) : null;
}

// Initial state; the Gamecast screen's socket (app/gamecast/[id].tsx) keeps
// this same cache entry current during the game.
export function useGamecastGame(gameId: string) {
  return useQuery({ queryKey: ['gamecast', gameId], queryFn: () => api.gamecastGame(gameId) });
}

export function useFantasyImpact(gameId: string, live: boolean) {
  return useQuery({
    queryKey: ['fantasy-impact', gameId],
    queryFn: () => api.fantasyImpact(gameId),
    refetchInterval: live ? LIVE_REFRESH_MS : false,
  });
}

export function usePlayFantasy(gameId: string, playId: string | null) {
  return useQuery({
    queryKey: ['play-fantasy', gameId, playId],
    queryFn: async () => (await api.playFantasy(gameId, playId!)).players,
    enabled: playId !== null,
    staleTime: Infinity,
  });
}
