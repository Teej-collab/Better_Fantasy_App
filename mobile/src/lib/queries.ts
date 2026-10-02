import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { focusManager, QueryClient, useMutation, useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { AppState } from 'react-native';

import { api } from '@/lib/api';
import type { MyTeam, RosterEntry, WeeklyAwards } from '@/lib/types';

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
    // A save made while offline fails straight away with the offline
    // message, instead of being held and fired whenever the connection
    // returns (a lineup change landing minutes later would surprise).
    mutations: { networkMode: 'always' },
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

// `enabled` is false while signed out (the app root asks for it either way).
export function useMe(enabled = true) {
  return useQuery({ queryKey: ['me'], queryFn: api.me, staleTime: 5 * 60_000, enabled });
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

// While live, re-asks on the 15s tick like the web's LastPlay: a play
// seconds old can come back before ESPN has attached its players, and a
// reviewed play can change.
export function usePlayFantasy(gameId: string, playId: string | null, live = false) {
  return useQuery({
    queryKey: ['play-fantasy', gameId, playId],
    queryFn: async () => (await api.playFantasy(gameId, playId!)).players,
    enabled: playId !== null,
    staleTime: live ? 0 : Infinity,
    refetchInterval: live ? LIVE_REFRESH_MS : false,
  });
}

// ---- Home ----

export function usePreferences() {
  return useQuery({ queryKey: ['preferences'], queryFn: api.preferences, staleTime: 5 * 60_000 });
}

export function useActiveLeagueName() {
  return useQuery({
    queryKey: ['my-leagues'],
    queryFn: api.myLeagues,
    staleTime: 5 * 60_000,
    select: (d) => d.leagues.find((l) => l.id === d.active_league_id)?.name ?? null,
  });
}

function hasAwardsData(a: WeeklyAwards): boolean {
  return (
    !!a.game_of_the_week ||
    a.boom_leaders.length > 0 ||
    a.bust_leaders.length > 0 ||
    !!a.biggest_bench_crime ||
    !!a.overachiever ||
    !!a.meltdown ||
    !!a.clutch ||
    !!a.choke
  );
}

// This week's awards once it has any, else last week's — a fresh week
// has nothing to award until its games start, so the web keeps the
// week that just wrapped on screen until then (2026-09-15 ask).
export function useHomeAwards(season: number | null, week: number | null) {
  const refetchInterval = useLiveRefetchInterval();
  return useQuery({
    queryKey: ['weekly-awards', season, week],
    enabled: season !== null && week !== null,
    refetchInterval,
    queryFn: async () => {
      const [current, previous] = await Promise.all([
        api.weeklyAwards(season!, week!),
        week! > 1 ? api.weeklyAwards(season!, week! - 1) : Promise.resolve(null),
      ]);
      if (hasAwardsData(current)) return { awards: current, week: week! };
      if (previous && hasAwardsData(previous)) return { awards: previous, week: week! - 1 };
      return null;
    },
  });
}

// The current week's recap once its games are final, else last week's
// (same pair of checks as the web home page).
export function useHomeRecap(season: number | null, week: number | null) {
  return useQuery({
    queryKey: ['weekly-recap', season, week],
    enabled: season !== null && week !== null,
    queryFn: async () => {
      const [current, previous] = await Promise.all([
        api.weeklyRecap(season!, week!),
        week! > 1 ? api.weeklyRecap(season!, week! - 1) : Promise.resolve({ narrative: null }),
      ]);
      if (current.narrative?.kind === 'recap') return { recap: current.narrative, week: week!, season: season! };
      if (previous.narrative?.kind === 'recap') return { recap: previous.narrative, week: week! - 1, season: season! };
      return null;
    },
  });
}

export function useLeagueTicker(season: number | null, week: number | null) {
  const refetchInterval = useLiveRefetchInterval();
  return useQuery({
    queryKey: ['league-ticker', season, week],
    queryFn: async () => (await api.leagueTicker(season!, week!)).items,
    enabled: season !== null && week !== null,
    refetchInterval,
  });
}

export function useLatestPowerRankings(season: number | null) {
  return useQuery({
    queryKey: ['power-rankings-latest', season],
    queryFn: () => api.latestPowerRankings(season!),
    enabled: season !== null,
  });
}

export function useRivalries() {
  return useQuery({ queryKey: ['rivalries'], queryFn: async () => (await api.rivalries()).rivalries });
}

// Only once the draft is done — before that nobody owes a chug.
export function useChugDeadline(enabled: boolean) {
  return useQuery({ queryKey: ['chug-deadline'], queryFn: api.chugDeadline, enabled });
}

// season undefined = all-time (the Chug page's All-Time tab).
export function useChugFeed(season: number | null | undefined) {
  return useQuery({
    queryKey: ['chug-feed', season ?? 'all'],
    queryFn: async () => (await api.chugFeed(season ?? undefined)).chugs,
    enabled: season !== null,
  });
}

export function useLeagueActivity(season: number | null, limit?: number) {
  return useQuery({
    queryKey: ['league-activity', season, limit ?? 'all'],
    queryFn: async () => (await api.leagueActivity(season!, limit)).items,
    enabled: season !== null,
  });
}

export function useChugSeasons() {
  return useQuery({ queryKey: ['chug-seasons'], queryFn: async () => (await api.chugSeasons()).seasons });
}

export function useChugLeaderboard(season: number | undefined) {
  return useQuery({
    queryKey: ['chug-leaderboard', season ?? 'all'],
    queryFn: async () => (await api.chugLeaderboard(season)).leaderboard,
    placeholderData: (previous) => previous,
  });
}

// stat_category → points per unit, for the score breakdown.
export function useScoringRates(season: number) {
  return useQuery({
    queryKey: ['scoring-rules', season],
    queryFn: async () =>
      Object.fromEntries((await api.scoringRules(season)).rules.map((r) => [r.stat_category, r.points_per_unit])) as Record<
        string,
        number
      >,
    staleTime: 60 * 60_000,
  });
}

// ---- League section ----

export function useSeasons() {
  return useQuery({
    queryKey: ['seasons'],
    queryFn: async () => [...(await api.seasons()).seasons].sort((a, b) => b - a),
    staleTime: 60 * 60_000,
  });
}

export function useSeasonTeams(season: number | null) {
  return useQuery({
    queryKey: ['season-teams', season],
    queryFn: async () => (await api.seasonTeams(season!)).teams,
    enabled: season !== null,
  });
}

export function usePolls(leagueId: number | null) {
  return useQuery({
    queryKey: ['polls', leagueId],
    queryFn: async () => (await api.polls(leagueId!)).polls,
    enabled: leagueId !== null,
  });
}

// The real bracket once it exists, else the projected first round.
export function usePlayoffs(season: number | null) {
  return useQuery({
    queryKey: ['playoffs', season],
    enabled: season !== null,
    queryFn: async () => {
      const { nodes } = await api.playoffBracket(season!);
      const projected = nodes.length === 0 ? (await api.projectedPlayoffs(season!)).matchups : null;
      return { nodes, projected };
    },
  });
}

export function useWeekPowerRankings(season: number | null) {
  return useQuery({
    queryKey: ['power-rankings-week', season],
    enabled: season !== null,
    queryFn: async () => {
      const { week } = await api.latestPowerRankingsWeek(season!);
      if (week === null) return { week: null, rankings: [] };
      return { week, rankings: (await api.weekPowerRankings(season!, week)).rankings };
    },
  });
}

export function usePowerRankingsTrend(season: number | null) {
  return useQuery({
    queryKey: ['power-rankings-trend', season],
    queryFn: async () => (await api.powerRankingsTrend(season!)).teams,
    enabled: season !== null,
  });
}

export function useAllTimePowerRankings() {
  return useQuery({ queryKey: ['power-rankings-all-time'], queryFn: async () => (await api.allTimePowerRankings()).categories });
}

export function useSeasonAwards(season: number) {
  return useQuery({ queryKey: ['season-awards', season], queryFn: () => api.seasonAwards(season) });
}

export function useRecordBook() {
  return useQuery({ queryKey: ['record-book'], queryFn: async () => (await api.recordBook()).categories });
}

export function useAwardLeaderboards() {
  return useQuery({ queryKey: ['award-leaderboards'], queryFn: async () => (await api.awardLeaderboards()).categories });
}

export function useOwners() {
  return useQuery({ queryKey: ['owners'], queryFn: async () => (await api.owners()).owners });
}

export function useCareerProfile(ownerId: number) {
  return useQuery({ queryKey: ['career', ownerId], queryFn: () => api.careerProfile(ownerId) });
}

export function useOwnerBadges(ownerId: number) {
  return useQuery({ queryKey: ['owner-badges', ownerId], queryFn: () => api.ownerBadges(ownerId) });
}

export function useSeasonProfile(ownerId: number, season: number | null) {
  return useQuery({
    queryKey: ['season-profile', ownerId, season],
    queryFn: () => api.seasonProfile(ownerId, season!),
    enabled: season !== null,
  });
}

export function useOwnerDraftGrade(season: number | null, ownerId: number) {
  return useQuery({
    queryKey: ['owner-draft-grade', season, ownerId],
    queryFn: () => api.ownerDraftGrade(season!, ownerId),
    enabled: season !== null,
  });
}

export function useSeasonDraftGrades(season: number) {
  return useQuery({ queryKey: ['draft-grades', season], queryFn: () => api.seasonDraftGrades(season) });
}

export function useTeamDetail(teamId: number) {
  return useQuery({ queryKey: ['team', teamId], queryFn: () => api.team(teamId) });
}

export function useTeamRoster(teamId: number, week: number | null) {
  return useQuery({
    queryKey: ['team-roster', teamId, week],
    queryFn: async () => (await api.teamRoster(teamId, week!)).roster,
    enabled: week !== null,
  });
}

export function useTradeTeams() {
  return useQuery({ queryKey: ['trade-teams'], queryFn: async () => (await api.tradeTeams()).teams });
}

export function useTradeRoster(teamId: number | null) {
  return useQuery({
    queryKey: ['trade-roster', teamId],
    queryFn: async () => (await api.tradeRoster(teamId!)).roster,
    enabled: teamId !== null,
  });
}

export function useMyTrades() {
  return useQuery({ queryKey: ['my-trades'], queryFn: async () => (await api.myTrades()).trades });
}

export function useMyKeepers() {
  return useQuery({ queryKey: ['my-keepers'], queryFn: api.myKeepers });
}

export function useMySettings() {
  return useQuery({ queryKey: ['my-settings'], queryFn: api.mySettings });
}

export function useFeedbackList(enabled: boolean) {
  return useQuery({ queryKey: ['feedback'], queryFn: async () => (await api.feedback()).items, enabled });
}

export function useChatMembers() {
  return useQuery({ queryKey: ['chat-members'], queryFn: api.chatMembers });
}

export function useWatchPartyRooms() {
  // Live dots and member counts change as people come and go.
  return useQuery({ queryKey: ['watch-party-rooms'], queryFn: api.watchPartyRooms, refetchInterval: 30_000 });
}

export function useWatchPartyMembers(roomId: number) {
  return useQuery({ queryKey: ['watch-party-members', roomId], queryFn: () => api.watchPartyMembers(roomId) });
}

export function useLoungeRooms() {
  return useQuery({ queryKey: ['lounge-rooms'], queryFn: api.loungeRooms });
}

// ---- Commissioner tools ----
export function useActiveLeague() {
  return useQuery({
    queryKey: ['leagues-mine'],
    queryFn: api.leaguesMine,
    select: (d) => d.leagues.find((l) => l.id === d.active_league_id) ?? null,
  });
}

export function useLeagueMembers(leagueId: number | undefined) {
  return useQuery({ queryKey: ['league-members', leagueId], queryFn: () => api.leagueMembers(leagueId!), enabled: leagueId !== undefined });
}

export function useLeagueTeams(leagueId: number | undefined) {
  return useQuery({ queryKey: ['league-teams', leagueId], queryFn: () => api.leagueTeams(leagueId!), enabled: leagueId !== undefined });
}

export function usePlayoffSettings() {
  return useQuery({ queryKey: ['playoff-settings'], queryFn: api.playoffSettings });
}

export function useScoringRulesEditor() {
  return useQuery({ queryKey: ['scoring-rules-editor'], queryFn: api.scoringRulesEditor });
}

export function useKeeperRules() {
  return useQuery({ queryKey: ['keeper-rules'], queryFn: api.keeperRules });
}

export function useRosterSettings() {
  return useQuery({
    queryKey: ['roster-settings'],
    queryFn: async () => {
      const [slots, max] = await Promise.all([api.rosterSlots(), api.positionMax()]);
      return { slots, max };
    },
  });
}

export function useTradeSettings() {
  return useQuery({ queryKey: ['trade-settings'], queryFn: api.tradeSettings });
}

export function usePendingTrades() {
  return useQuery({ queryKey: ['pending-trades'], queryFn: api.pendingTrades });
}

export function useEspnConnection() {
  return useQuery({ queryKey: ['espn-connection'], queryFn: api.espnConnection });
}

// ---- Bet tracking ----

export function useBets() {
  return useQuery({
    queryKey: ['bets'],
    queryFn: api.bets,
    // Open legs move with the games.
    refetchInterval: (q) => (q.state.data?.bets.some((b) => b.status === 'open') ? 30_000 : false),
  });
}

export function useBetsInGame(eventId: string, live: boolean) {
  return useQuery({
    queryKey: ['bets-in-game', eventId],
    queryFn: () => api.betsInGame(eventId),
    refetchInterval: live ? LIVE_REFRESH_MS : false,
  });
}

export function useSharedBet(betId: number) {
  return useQuery({
    queryKey: ['shared-bet', betId],
    queryFn: () => api.sharedBet(betId),
    retry: false,
    refetchInterval: (q) => (q.state.data?.status === 'open' ? 30_000 : false),
  });
}

export function useChugLedger(season: number | undefined) {
  return useQuery({ queryKey: ['chug-ledger', season], queryFn: () => api.chugLedger(season) });
}
