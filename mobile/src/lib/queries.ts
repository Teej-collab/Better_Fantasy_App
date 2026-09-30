import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient, useMutation, useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';

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
  return useQuery({ queryKey: ['my-week'], queryFn: api.myWeek });
}

export function useMatchupContext(season: number | null, week: number | null) {
  return useQuery({
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
  return useQuery({ queryKey: ['matchup', matchupId], queryFn: () => api.matchup(matchupId) });
}

export function useMyTeam() {
  return useQuery({ queryKey: ['my-team'], queryFn: api.myTeam });
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
