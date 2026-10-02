import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { ActionSheetIOS, Alert, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppRefreshControl } from '@/components/AppRefreshControl';
import { BetCard } from '@/components/bets/BetCard';
import { ShareableCard } from '@/components/ShareableCard';
import { Display, Text } from '@/components/Text';
import { LoadingState, MessageState } from '@/components/ui';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { useAppearance } from '@/lib/appearance';
import { haptics } from '@/lib/haptics';
import { queryClient, useBets } from '@/lib/queries';
import type { Bet, BetLegStatus, BetStatus } from '@/lib/types';

// My Bets (port of the web's /bets): your tracked bets, graded live from
// the box score. Private unless you share one to league chat. Tracking
// only — nothing here places a bet.
export default function BetsScreen() {
  const accent = useAppearance().accent;
  const q = useBets();
  const [error, setError] = useState<string | null>(null);

  if (q.isPending) return <LoadingState />;
  if (q.isError || !q.data) return <MessageState message="Couldn't load your bets." />;

  if (!q.data.enabled) {
    return (
      <View style={styles.offState}>
        <Stack.Screen options={{ title: 'My Bets' }} />
        <Display style={styles.title}>Bet tracking is off</Display>
        <Text style={styles.soft}>Turn it on in Settings to track your bets here and on the Gamecast.</Text>
        <Pressable
          onPress={() => router.push({ pathname: '/settings', params: { section: 'bets' } })}
          style={[styles.primary, { backgroundColor: accent }]}
          accessibilityRole="button">
          <Text style={styles.primaryText}>Open Settings</Text>
        </Pressable>
      </View>
    );
  }

  const bets = q.data.bets;
  const open = bets.filter((b) => b.status === 'open');
  const settled = bets.filter((b) => b.status !== 'open');
  const won = settled.filter((b) => b.status === 'won').length;
  const lost = settled.filter((b) => b.status === 'lost').length;

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: ['bets'] });
    } catch (e) {
      haptics.error();
      setError(e instanceof Error ? e.message : 'Something went wrong — try again.');
    }
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={<AppRefreshControl />}>
      <Stack.Screen options={{ title: 'My Bets' }} />
      <View style={styles.header}>
        <View style={styles.flex}>
          <Display style={styles.title}>My Bets</Display>
          <Text style={styles.soft}>
            Tracked live. Only you can see these unless you share one.
            {settled.length > 0 ? ` Record: ${won}–${lost}.` : ''}
          </Text>
        </View>
      </View>
      <Pressable
        onPress={() => router.push('/bets/add')}
        style={[styles.primary, { backgroundColor: accent }]}
        accessibilityRole="button">
        <Text style={styles.primaryText}>+ Add a bet</Text>
      </Pressable>
      {error && <Text style={styles.error}>{error}</Text>}

      {bets.length === 0 && (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>🧾</Text>
          <Text style={styles.emptyTitle}>No bets yet</Text>
          <Text style={styles.soft}>
            Add a screenshot of a bet slip from any sportsbook and every leg tracks live — here and on that game&apos;s Gamecast.
          </Text>
        </View>
      )}

      {open.length > 0 && <Text style={styles.section}>Open</Text>}
      {open.map((bet) => (
        <OwnBet key={bet.id} bet={bet} run={run} />
      ))}
      {settled.length > 0 && <Text style={styles.section}>Settled</Text>}
      {settled.map((bet) => (
        <OwnBet key={bet.id} bet={bet} run={run} />
      ))}

      <Text style={styles.disclaimer}>
        The Weekend only tracks bets — it never places them or touches money. 21+. If gambling stops being fun, call or text
        1-800-GAMBLER.
      </Text>
    </ScrollView>
  );
}

function OwnBet({ bet, run }: { bet: Bet; run: (action: () => Promise<unknown>) => Promise<void> }) {
  const accent = useAppearance().accent;
  const untracked = bet.legs.filter((l) => !l.tracked && l.status === 'open');

  function toggleShare() {
    if (bet.shared) {
      void run(() => api.unshareBet(bet.id));
      return;
    }
    Alert.alert(
      'Share to league chat?',
      'Everyone in your league will see the picks and how they’re doing. Your wager and payout stay private.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Share',
          onPress: () =>
            void run(async () => {
              await api.shareBet(bet.id);
              haptics.success();
            }),
        },
      ],
    );
  }

  function markLeg(legId: number, description: string) {
    const options: BetLegStatus[] = ['won', 'lost', 'push'];
    Alert.alert(`Mark “${description}”`, undefined, [
      ...options.map((s) => ({
        text: s[0].toUpperCase() + s.slice(1),
        onPress: () => void run(() => api.setBetLegStatus(bet.id, legId, s)),
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }

  function more() {
    const statuses: { label: string; status: BetStatus | 'auto' }[] = [
      { label: 'Mark won', status: 'won' },
      { label: 'Mark lost', status: 'lost' },
      { label: 'Mark cashed out', status: 'cashed_out' },
      { label: 'Mark void', status: 'void' },
      ...(bet.status_set_manually ? [{ label: 'Grade automatically', status: 'auto' as const }] : []),
    ];
    const labels = [...statuses.map((s) => s.label), 'Delete bet', 'Cancel'];
    const onPick = (i: number) => {
      if (i < statuses.length) void run(() => api.setBetStatus(bet.id, statuses[i].status));
      else if (i === statuses.length)
        Alert.alert('Delete this bet?', undefined, [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => void run(() => api.deleteBet(bet.id)),
          },
        ]);
    };
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: labels,
          cancelButtonIndex: labels.length - 1,
          destructiveButtonIndex: labels.length - 2,
        },
        onPick,
      );
    } else {
      Alert.alert('Bet options', undefined, [
        ...labels.slice(0, -1).map((text, i) => ({ text, onPress: () => onPick(i) })),
        { text: 'Cancel', style: 'cancel' as const },
      ]);
    }
  }

  return (
    <View style={styles.ownBet}>
      {/* Only the card goes in the shared image, not these buttons. */}
      <ShareableCard title={bet.legs.length > 1 ? `My ${bet.legs.length}-leg parlay` : 'My bet'}>
        <BetCard bet={bet} />
      </ShareableCard>
      <View style={styles.actions}>
        {untracked.map((leg) => (
          <Pressable key={leg.id} onPress={() => markLeg(leg.id, leg.description)} style={styles.chip} accessibilityRole="button">
            <Text style={styles.chipText} numberOfLines={1}>
              Mark “{leg.description}”
            </Text>
          </Pressable>
        ))}
        <View style={styles.actionRow}>
          <Pressable
            onPress={toggleShare}
            accessibilityRole="switch"
            accessibilityState={{ checked: bet.shared }}
            style={[
              styles.chip,
              bet.shared && {
                backgroundColor: `${accent}26`,
                borderColor: accent,
              },
            ]}>
            <Text style={[styles.chipText, bet.shared && { color: accent }]}>
              {bet.shared ? '✓ Shared with league' : 'Share to league'}
            </Text>
          </Pressable>
          <Pressable onPress={more} style={styles.chip} accessibilityRole="button" accessibilityLabel="Bet options">
            <Text style={styles.chipText}>More</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    padding: Spacing.lg,
    paddingBottom: Spacing.xl * 2,
    gap: Spacing.md,
  },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.md },
  title: { color: Colors.text, fontSize: 24 },
  soft: { color: Colors.textSecondary, fontSize: 13, lineHeight: 19 },
  error: { color: Colors.loss, fontSize: 13 },
  primary: {
    borderRadius: Radius.pill,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryText: { color: '#06110a', fontSize: 15, fontWeight: '700' },
  section: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: Spacing.sm,
  },
  empty: {
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.xl,
  },
  emptyIcon: { fontSize: 32 },
  emptyTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' },
  ownBet: { gap: Spacing.sm },
  actions: { gap: Spacing.sm, paddingHorizontal: Spacing.xs },
  actionRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    justifyContent: 'space-between',
  },
  chip: {
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignSelf: 'flex-start',
  },
  chipText: { color: Colors.text, fontSize: 12, fontWeight: '600' },
  offState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    padding: Spacing.xl,
  },
  disclaimer: {
    color: Colors.textSecondary,
    fontSize: 11,
    textAlign: 'center',
    marginTop: Spacing.lg,
    lineHeight: 16,
  },
});
