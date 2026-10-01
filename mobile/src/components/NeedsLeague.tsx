import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { NeonPanel } from '@/components/NeonPanel';
import { Display, Text } from '@/components/Text';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useAppearance } from '@/lib/appearance';
import { takePendingLeagueIntent } from '@/lib/onboarding';

function openLeagues(focus?: 'join' | 'create') {
  router.push(focus ? { pathname: '/leagues', params: { focus } } : '/leagues');
}

// A signed-in account with no active league yet (a new email sign-up):
// the web's NeedsLeagueCard / Welcome Back "join or create" step, in
// place of every tab's league data. Someone who picked Join or Create
// on the sign-in screen lands straight on that step.
export function NeedsLeague({ displayName }: { displayName: string | null }) {
  const accent = useAppearance().accent;
  useEffect(() => {
    const intent = takePendingLeagueIntent();
    if (intent) openLeagues(intent);
  }, []);
  return (
    <View style={styles.wrap}>
      <NeonPanel color={accent} contentStyle={styles.card}>
        <Display style={styles.title}>Welcome{displayName ? `, ${displayName}` : ''}</Display>
        <Text style={styles.body}>
          You&apos;re not on a team yet — join a league you&apos;re already in, or start one of your own.
        </Text>
        <Pressable onPress={() => openLeagues('join')} style={({ pressed }) => [styles.primary, { backgroundColor: accent }, pressed && styles.pressed]}>
          <Text style={styles.primaryText}>Join a League</Text>
        </Pressable>
        <Pressable onPress={() => openLeagues('create')} style={({ pressed }) => [styles.outline, pressed && styles.pressed]}>
          <Text style={styles.outlineText}>Create a League</Text>
        </Pressable>
      </NeonPanel>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'center', padding: Spacing.xl },
  card: { alignItems: 'center', gap: Spacing.md, padding: Spacing.xl },
  title: { fontSize: 24, textAlign: 'center' },
  body: { color: Colors.textSecondary, fontSize: 14, lineHeight: 20, textAlign: 'center', marginBottom: Spacing.sm },
  primary: { alignSelf: 'stretch', alignItems: 'center', borderRadius: Radius.pill, paddingVertical: 14 },
  primaryText: { color: '#06110a', fontSize: 15, fontWeight: '600' },
  outline: { alignSelf: 'stretch', alignItems: 'center', borderRadius: Radius.pill, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface, paddingVertical: 13 },
  outlineText: { color: Colors.text, fontSize: 15, fontWeight: '500' },
  pressed: { opacity: 0.7 },
});
