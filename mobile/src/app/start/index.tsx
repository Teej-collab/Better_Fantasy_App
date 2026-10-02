import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, Stack } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Door, GhostButton, Icon, Kicker, StartScreen, startStyles, Sub, Title } from '@/components/start/StartUI';
import { Text } from '@/components/Text';
import { LoadingState } from '@/components/ui';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { queryClient, useMe } from '@/lib/queries';
import { seasonalEmblem } from '@/lib/seasonal';

// The front door for joining or creating a league (port of the web's
// /start, components/start/StartFlow.tsx): two doors for someone with no
// league yet, or "Welcome back" with their leagues for someone who has
// one. Join and Create are their own screens (start/join, start/create).
export default function StartScreenRoute() {
  const me = useMe().data;
  const q = useQuery({ queryKey: ['leagues-mine'], queryFn: api.leaguesMine });
  if (q.isPending) return <LoadingState />;
  const leagues = q.data?.leagues ?? [];
  const activeId = q.data?.active_league_id ?? null;

  async function open(leagueId: number) {
    haptics.tap();
    if (leagueId !== activeId) await api.selectLeague(leagueId).catch(() => {});
    await queryClient.invalidateQueries();
    router.replace('/');
  }

  if (leagues.length > 0) {
    return (
      <StartScreen
        footer={
          <View style={styles.row}>
            <GhostButton label="Join another" onPress={() => router.push('/start/join')} flex />
            <GhostButton label="Create new" onPress={() => router.push('/start/create')} flex />
          </View>
        }>
        <Stack.Screen
          options={{
            title: 'Your Leagues',
            headerRight: () => (
              <Pressable onPress={() => router.push('/leagues')} hitSlop={8} accessibilityRole="button">
                <Text style={styles.manage}>Manage</Text>
              </Pressable>
            ),
          }}
        />
        <View style={styles.welcomeRow}>
          <Image source={seasonalEmblem()} style={styles.smallEmblem} contentFit="contain" accessible={false} />
          <View>
            <Kicker>Welcome back</Kicker>
            <Text style={styles.name}>{me?.display_name ?? 'Commish'}</Text>
          </View>
        </View>
        <View style={styles.list}>
          <Kicker>Your leagues</Kicker>
          {leagues.map((l) => (
            <Pressable
              key={l.id}
              onPress={() => void open(l.id)}
              accessibilityRole="button"
              accessibilityLabel={`${l.name}${l.id === activeId ? ', active' : ''}`}
              style={({ pressed }) => [startStyles.card, l.id === activeId && startStyles.cardLit, pressed && styles.pressed]}>
              <View style={styles.cardTop}>
                <Text style={startStyles.cardTitle}>{l.name}</Text>
                {l.id === activeId && (
                  <View style={styles.activePill}>
                    <Text style={styles.activeText}>Active</Text>
                  </View>
                )}
              </View>
              <Text style={[startStyles.muted, styles.capital]}>{l.role}</Text>
            </Pressable>
          ))}
        </View>
      </StartScreen>
    );
  }

  return (
    <StartScreen>
      <Stack.Screen options={{ title: 'Get Started' }} />
      <View style={styles.hero}>
        <Image source={seasonalEmblem()} style={styles.emblem} contentFit="contain" accessibilityLabel="The Weekend" />
        <Kicker>Welcome to The Weekend</Kicker>
        <Title>Let&apos;s get you into a league</Title>
        <Sub>Every league here keeps its history, chat, chugs and trash talk in one place.</Sub>
      </View>
      <View style={styles.list}>
        <Door title="Join a league" text="Got an invite link, code or QR from your commissioner?" accent="#39ff14" icon="users" onPress={() => router.push('/start/join')} />
        <Door title="Create a league" text="Start your own and run it as commissioner." accent="#2fd0ff" icon="plus" onPress={() => router.push('/start/create')} />
      </View>
      <Pressable
        onPress={() => router.push({ pathname: '/start/create', params: { from: 'espn' } })}
        accessibilityRole="button"
        style={({ pressed }) => [styles.espn, pressed && styles.pressed]}>
        <Icon name="download" color="#fbbf24" size={20} />
        <Text style={[startStyles.muted, styles.flex]}>
          <Text style={styles.strong}>Moving from ESPN?</Text> Bring your league over with every past season, record and rivalry.
        </Text>
      </Pressable>
    </StartScreen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', gap: Spacing.sm },
  pressed: { opacity: 0.8 },
  hero: { alignItems: 'center', gap: Spacing.md, paddingTop: Spacing.md },
  emblem: { width: 120, height: 120 },
  list: { gap: Spacing.md },
  welcomeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  smallEmblem: { width: 56, height: 56 },
  name: { fontFamily: Fonts.displayBold, fontSize: 30, letterSpacing: 1, color: Colors.accent, textShadowColor: 'rgba(57,255,20,0.55)', textShadowRadius: 12 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  activePill: { borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: 'rgba(57,255,20,0.14)' },
  activeText: { color: Colors.accent, fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  capital: { textTransform: 'capitalize' },
  espn: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.lg, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: '#2a303a' },
  strong: { color: Colors.text, fontWeight: '700' },
  manage: { color: Colors.accent, fontSize: 15, fontWeight: '600' },
});
