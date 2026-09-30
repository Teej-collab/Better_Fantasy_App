import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient, useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

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
