import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Text';
import { Colors, Spacing } from '@/constants/theme';
import { api, WEB_BASE_URL } from '@/lib/api';
import { queryClient, useMe } from '@/lib/queries';

// A shared card's link (…/s/TOKEN) opening the app (2026-11-17): look up
// what it shows and go straight there, switching to its league first.
// Someone outside that league sees the card itself instead.

type Shared = { kind: string; league_name: string; league_id: number; ref: Record<string, string | number>; card: { invite_code?: string } };

function screenFor(s: Shared): Href | null {
  const r = s.ref;
  switch (s.kind) {
    case 'matchup':
      return { pathname: '/matchup/[id]', params: { id: String(r.matchup_id) } };
    case 'recap':
      return { pathname: '/recap/[season]/[week]', params: { season: String(r.season), week: String(r.week) } };
    case 'standings':
      return { pathname: '/league', params: { section: 'standings' } } as unknown as Href;
    case 'power':
      return { pathname: '/league', params: { section: 'powerRankings' } } as unknown as Href;
    case 'awards':
    case 'season_awards':
    case 'champion':
      return { pathname: '/awards/[season]', params: { season: String(r.season) } };
    case 'chug':
      return '/chug' as Href;
    case 'bet':
      return '/bets/league' as Href;
    case 'trade':
      return { pathname: '/trade/[id]', params: { id: String(r.trade_id) } };
    case 'wheel':
      return '/punishment-wheel' as Href;
    case 'player':
      return { pathname: '/player/[id]', params: { id: String(r.player_id) } };
    default:
      return null;
  }
}

export default function SharedLinkScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const me = useMe().data;
  const [outside, setOutside] = useState<Shared | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || me === undefined) return;
    let live = true;
    (async () => {
      try {
        const shared = await api.sharedCard(token);
        if (!live) return;
        if (shared.kind === 'invite' && shared.card.invite_code) {
          router.replace({ pathname: '/start/join', params: { code: shared.card.invite_code } });
          return;
        }
        const target = screenFor(shared);
        if (!target) {
          setOutside(shared);
          return;
        }
        if (me && me.active_league_id !== shared.league_id) {
          try {
            await api.selectLeague(shared.league_id);
            await queryClient.invalidateQueries();
          } catch {
            // Not in that league: show the card instead.
            if (live) setOutside(shared);
            return;
          }
        }
        if (live) router.replace(target);
      } catch {
        if (live) setError("That link doesn't go anywhere anymore.");
      }
    })();
    return () => {
      live = false;
    };
  }, [token, me]);

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: outside?.league_name ?? 'Shared' }} />
      {outside ? (
        <View style={styles.card}>
          <Image source={{ uri: `${WEB_BASE_URL}/s/${token}/image?f=post` }} style={styles.image} contentFit="contain" accessibilityLabel={`Shared from ${outside.league_name}`} />
          <Text style={styles.note}>Shared from {outside.league_name}. You&apos;re not in that league.</Text>
        </View>
      ) : error ? (
        <Text style={styles.note}>{error}</Text>
      ) : (
        <ActivityIndicator color={Colors.accent} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center', padding: Spacing.lg },
  card: { width: '100%', gap: Spacing.md, alignItems: 'center' },
  image: { width: '100%', aspectRatio: 1080 / 1350, borderRadius: 22 },
  note: { color: Colors.textSecondary, fontSize: 14, textAlign: 'center' },
});
