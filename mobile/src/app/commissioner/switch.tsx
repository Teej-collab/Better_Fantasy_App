import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { BigButton, GroupTitle, PageTitle, Panel, partStyles as p, TONES } from '@/components/commissioner/CommishParts';
import { CommishScreen, ErrorText, errorMessage } from '@/components/commissioner/CommishUI';
import { Text } from '@/components/Text';
import { LoadingState } from '@/components/ui';
import { Colors, Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { queryClient, useLeagueSwitch } from '@/lib/queries';

// Moving the league to The Weekend for good (2026-10-24, backend
// app/domain/league_switch.py). While the league still runs on ESPN or
// Sleeper (mirror mode) rosters copy over from there and moves are locked
// here; this unlocks everything. It never happens mid-week: asked for once
// the week's games have started, it's set for the start of next week.

function refresh() {
  for (const key of ['league-switch', 'commish', 'me', 'my-team']) void queryClient.invalidateQueries({ queryKey: [key] });
}

export default function LeagueSwitchScreen() {
  const q = useLeagueSwitch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const s = q.data;

  if (q.isPending) return <LoadingState />;
  if (!s) return <ErrorText>{errorMessage(q.error, "Couldn't load this.")}</ErrorText>;

  const allIn = s.claimed >= s.teams && s.teams > 0;

  async function go() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.requestLeagueSwitch();
      haptics.success();
      refresh();
      Alert.alert(
        r.switched ? 'You’re on The Weekend' : `Set for Week ${r.effective_week}`,
        r.switched
          ? 'Roster moves are unlocked and everyone has been told.'
          : 'This week’s games have started, so the move happens when the next week begins. Everyone will be told then.',
      );
      if (r.switched) router.back();
    } catch (e) {
      setError(errorMessage(e, 'That didn’t go through.'));
    } finally {
      setBusy(false);
    }
  }

  function confirm() {
    Alert.alert(
      'Move the league to The Weekend?',
      `${allIn ? '' : `${s!.teams - s!.claimed} team${s!.teams - s!.claimed === 1 ? '' : 's'} haven’t joined yet. They can still claim their team after. `}From then on, lineups, adds, drops, waivers and trades happen here, and moves on ${s!.platform_name} stop counting. This can’t be undone.`,
      [
        { text: 'Not yet', style: 'cancel' },
        { text: 'Move us over', style: 'destructive', onPress: () => void go() },
      ],
    );
  }

  async function cancel() {
    setBusy(true);
    try {
      await api.cancelLeagueSwitch();
      refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!s.mirrored) {
    return (
      <CommishScreen>
        <Stack.Screen options={{ title: 'Move to The Weekend' }} />
        <PageTitle title="You're on The Weekend" subtitle={s.switched_from ? `Moved over from ${s.switched_from === 'espn' ? 'ESPN' : 'Sleeper'}.` : undefined} />
        <Text style={p.sub}>Every roster move happens here now.</Text>
      </CommishScreen>
    );
  }

  return (
    <CommishScreen>
      <Stack.Screen options={{ title: 'Move to The Weekend' }} />
      <PageTitle
        title={allIn ? 'Loving The Weekend?' : 'Move to The Weekend'}
        subtitle={`Right now your league runs on ${s.platform_name}: rosters copy over from there and moves are locked here.`}
      />

      <Panel color={allIn ? Colors.accent : TONES.yellow}>
        <View style={styles.countRow}>
          <Text style={styles.count}>
            {s.claimed} of {s.teams}
          </Text>
          <Text style={p.sub}>teams are here</Text>
        </View>
        <View style={styles.bar}>
          <View style={[styles.barFill, { width: `${Math.max(4, (s.claimed / Math.max(1, s.teams)) * 100)}%`, backgroundColor: allIn ? Colors.accent : TONES.yellow }]} />
        </View>
        {s.unclaimed.length > 0 && <Text style={p.sub}>Still waiting on: {s.unclaimed.join(', ')}</Text>}
      </Panel>

      <GroupTitle title="What moving over does" color={TONES.blue} />
      <View style={styles.list}>
        <Text style={styles.item}>• One last sync from {s.platform_name}: every result, roster and lineup.</Text>
        <Text style={styles.item}>• Your scoring rules, roster spots, playoffs and waivers (FAAB budgets included) come with it.</Text>
        <Text style={styles.item}>• The rest of the schedule stays the same.</Text>
        <Text style={styles.item}>• Lineups, adds, drops, waivers and trades unlock here, and everyone gets a notification.</Text>
        <Text style={styles.item}>
          • Never mid-week: once this week&apos;s games have started, it happens when the next week begins.
        </Text>
        <Text style={styles.item}>• Tell your league to stop making moves on {s.platform_name} after this.</Text>
      </View>

      {s.notes.length > 0 && (
        <>
          <GroupTitle title="Close, but not exact" color={TONES.orange} />
          <View style={styles.list}>
            {s.notes.map((n, i) => (
              <Text key={i} style={styles.item}>
                • {n}
              </Text>
            ))}
          </View>
        </>
      )}

      {error && <ErrorText>{error}</ErrorText>}
      {s.pending ? (
        <View style={styles.list}>
          <Text style={styles.pending}>Set to move over at the start of Week {s.pending.effective_week}.</Text>
          <BigButton label="Cancel the move" tone="outline" busy={busy} onPress={() => void cancel()} />
        </View>
      ) : (
        <BigButton label={allIn ? 'We’re all in: move us over' : 'Move us over anyway'} busyLabel="Moving…" busy={busy} onPress={confirm} />
      )}
    </CommishScreen>
  );
}

const styles = StyleSheet.create({
  countRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  count: { color: Colors.text, fontSize: 28, fontWeight: '800' },
  bar: { height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.1)', overflow: 'hidden', marginVertical: Spacing.sm },
  barFill: { height: 8 },
  list: { gap: 8 },
  item: { color: Colors.text, fontSize: 14, lineHeight: 20 },
  pending: { color: TONES.yellow, fontSize: 15, fontWeight: '700' },
});
