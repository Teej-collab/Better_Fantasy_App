import { useQuery } from '@tanstack/react-query';
import { router, Stack, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ANTON, Elite, EliteCard, EliteTitle } from '@/components/elite/Elite';
import { LivesPips, StatusHex, TeamLogo } from '@/components/survivor/SurvivorKit';
import { Text } from '@/components/Text';
import { LoadingState, MessageState } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { formatGameTimeShort } from '@/lib/format';
import { haptics } from '@/lib/haptics';
import { registerForPush } from '@/lib/pushRegistration';
import { queryClient } from '@/lib/queries';
import type { SurvivorPoolSummary } from '@/lib/survivorTypes';

// The Survivor hub (2026-11-07, canvas "Elite Survivor Pools"): every
// pool you're in or can join from your leagues, where each of your
// entries stands, and a nudge for any entry still missing this week's
// pick. Create a pool or join one with a code from here.
export default function SurvivorHubScreen() {
  const q = useQuery({ queryKey: ['survivor-pools'], queryFn: api.survivorPools });
  const [refreshing, setRefreshing] = useState(false);
  const [code, setCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const inAPool = Boolean(q.data?.pools.some((p) => p.mine.length > 0));
  // Pick reminders need this phone registered, and someone who's only in
  // survivor pools (no league) never got asked from the tabs.
  useEffect(() => {
    if (inAPool) registerForPush().catch(() => {});
  }, [inAPool]);

  if (q.isPending) return <LoadingState />;
  if (!q.data) return <MessageState message="Couldn't load your pools." actionLabel="Try again" onAction={() => void q.refetch()} />;
  const hub = q.data;
  const needing = hub.pools.reduce((n, p) => n + p.mine.filter((m) => m.needs_pick).length, 0);

  async function join(body: { code?: string; pool_id?: number }) {
    setJoining(true);
    try {
      const res = await api.joinSurvivorPool(body);
      haptics.success();
      setCode('');
      setShowJoin(false);
      await queryClient.invalidateQueries({ queryKey: ['survivor-pools'] });
      router.push(`/survivor/pick/${res.entry_id}` as Href);
    } catch (e) {
      haptics.error();
      Alert.alert("Couldn't join", e instanceof Error ? e.message : 'Try again.');
    } finally {
      setJoining(false);
    }
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={Elite.green}
          onRefresh={async () => {
            setRefreshing(true);
            await q.refetch();
            setRefreshing(false);
          }}
        />
      }>
      <Stack.Screen options={{ title: 'Survivor' }} />
      <EliteTitle kicker={`Week ${hub.week}`} title="Survivor" subtitle={hub.next_lock ? `Next lock ${formatGameTimeShort(hub.next_lock)}` : null} />

      {needing > 0 && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            {needing} {needing === 1 ? 'entry still needs' : 'entries still need'} a week {hub.week} pick
          </Text>
        </View>
      )}

      {hub.pools.length === 0 && (
        <EliteCard style={styles.pad}>
          <Text style={styles.emptyTitle}>No pools yet</Text>
          <Text style={styles.muted}>Pick one NFL team to win each week. Lose and you&apos;re out, and you can only use each team once. Start a pool or join one with its code.</Text>
        </EliteCard>
      )}

      {hub.pools.map((p) => (
        <PoolCard key={p.id} pool={p} joining={joining} onJoin={() => void join({ pool_id: p.id })} />
      ))}

      {showJoin ? (
        <EliteCard style={[styles.pad, styles.joinCard]}>
          <Text style={styles.label}>JOIN WITH A CODE</Text>
          <TextInput
            value={code}
            onChangeText={(t) => setCode(t.toUpperCase())}
            placeholder="6-letter code"
            placeholderTextColor={Elite.grey}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={6}
            style={styles.input}
            accessibilityLabel="Pool code"
            onSubmitEditing={() => code.trim() && void join({ code: code.trim() })}
          />
          <Pressable
            disabled={!code.trim() || joining}
            onPress={() => void join({ code: code.trim() })}
            style={[styles.primary, (!code.trim() || joining) && styles.disabled]}
            accessibilityRole="button">
            <Text style={styles.primaryText}>{joining ? 'Joining…' : 'Join pool'}</Text>
          </Pressable>
        </EliteCard>
      ) : null}

      <View style={styles.actions}>
        <Pressable onPress={() => router.push('/survivor/new' as Href)} style={[styles.action, styles.actionGreen]} accessibilityRole="button">
          <Text style={[styles.actionText, { color: Elite.green }]}>+ Create a pool</Text>
        </Pressable>
        <Pressable onPress={() => setShowJoin((v) => !v)} style={styles.action} accessibilityRole="button">
          <Text style={styles.actionText}>{showJoin ? 'Cancel' : 'Join with code'}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function PoolCard({ pool, joining, onJoin }: { pool: SurvivorPoolSummary; joining: boolean; onJoin: () => void }) {
  const mine = pool.mine;
  const alive = mine.some((m) => m.alive);
  const lead = mine[0];
  const label = mine.length === 0 ? 'JOIN' : mine.length > 1 ? `${mine.filter((m) => m.alive).length}/${mine.length}` : alive ? 'ALIVE' : 'OUT';
  return (
    <Pressable onPress={() => router.push(`/survivor/${pool.id}` as Href)} accessibilityRole="button" accessibilityLabel={`${pool.name}, ${pool.alive} of ${pool.entries} alive`}>
      <EliteCard tone={alive && mine.some((m) => m.needs_pick) ? 'green' : 'plain'} style={[styles.pad, styles.card, mine.length > 0 && !alive && styles.cardOut]}>
        <View style={styles.cardHead}>
          <StatusHex label={label} alive={alive || mine.length === 0} />
          <View style={styles.flex}>
            <Text style={styles.poolName} numberOfLines={1}>
              {pool.name}
            </Text>
            <View style={styles.meta}>
              <Text style={[styles.tag, pool.league_id ? styles.tagLeague : styles.tagSolo]}>{pool.league_id ? 'LEAGUE' : 'STANDALONE'}</Text>
              <Text style={styles.muted}>
                {pool.alive} of {pool.entries} alive
              </Text>
              {mine.length === 1 && lead.alive && <LivesPips left={lead.lives_left} total={lead.lives_total} />}
            </View>
          </View>
        </View>
        {pool.winners.length > 0 && <Text style={styles.winner}>Winner: {pool.winners.join(', ')}</Text>}
        {mine.length === 0 ? (
          <View style={styles.entryRow}>
            <Text style={styles.muted}>{pool.can_add_entry ? `Starts week ${pool.start_week}` : 'This pool already started'}</Text>
            {pool.can_add_entry && (
              <Pressable onPress={onJoin} disabled={joining} style={styles.pickButton} accessibilityRole="button">
                <Text style={styles.pickButtonText}>Join</Text>
              </Pressable>
            )}
          </View>
        ) : (
          mine.map((m) => {
            const pick = m.picks.find((p) => !p.hidden && p.team);
            return (
              <View key={m.entry_id} style={styles.entryRow}>
                {mine.length > 1 && <Text style={styles.entryNo}>Entry {m.entry_no}</Text>}
                {!m.alive ? (
                  <Text style={[styles.muted, styles.flex]}>Out in week {m.eliminated_week}</Text>
                ) : pick && !pick.hidden ? (
                  <View style={[styles.flex, styles.pickRow]}>
                    <TeamLogo team={pick.team} size={24} />
                    <Text style={styles.pickText}>
                      {pick.team}{' '}
                      <Text style={styles.muted}>
                        {pick.home ? 'vs' : '@'} {pick.opponent}
                      </Text>
                    </Text>
                  </View>
                ) : m.needs_pick ? (
                  <Text style={[styles.needs, styles.flex]}>No week {pool.week} pick yet</Text>
                ) : (
                  <Text style={[styles.muted, styles.flex]}>Starts week {pool.start_week}</Text>
                )}
                {m.alive && pool.week >= pool.start_week && (
                  <Pressable onPress={() => router.push(`/survivor/pick/${m.entry_id}` as Href)} style={m.needs_pick ? styles.pickButtonSolid : styles.pickButton} accessibilityRole="button">
                    <Text style={m.needs_pick ? styles.pickButtonSolidText : styles.pickButtonText}>{m.needs_pick ? 'Make pick' : 'Change'}</Text>
                  </Pressable>
                )}
              </View>
            );
          })
        )}
      </EliteCard>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pad: { padding: 16 },
  screen: { flex: 1, backgroundColor: Elite.deep },
  content: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: 80 },
  banner: { padding: 12, borderRadius: 12, backgroundColor: 'rgba(255,122,26,0.12)', borderWidth: 1, borderColor: 'rgba(255,122,26,0.45)' },
  bannerText: { color: Elite.peach, fontSize: 13, fontWeight: '600' },
  emptyTitle: { color: Elite.cream, fontSize: 16, fontWeight: '800', marginBottom: 4 },
  muted: { color: Elite.soft, fontSize: 12 },
  card: { gap: 12 },
  cardOut: { opacity: 0.7 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  flex: { flex: 1, minWidth: 0 },
  poolName: { color: Elite.cream, fontSize: 16, fontWeight: '800' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3, flexWrap: 'wrap' },
  tag: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' },
  tagLeague: { color: Elite.blue, backgroundColor: 'rgba(125,211,252,0.14)' },
  tagSolo: { color: Elite.peach, backgroundColor: 'rgba(255,178,122,0.14)' },
  winner: { color: Elite.green, fontSize: 13, fontWeight: '700' },
  entryRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: Elite.line },
  entryNo: { color: Elite.faint, fontSize: 12, width: 52 },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pickText: { color: Elite.cream, fontSize: 13, fontWeight: '700' },
  needs: { color: Elite.peach, fontSize: 13, fontWeight: '600' },
  pickButton: { minHeight: 36, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, borderColor: Elite.green, justifyContent: 'center' },
  pickButtonText: { color: Elite.green, fontSize: 12, fontWeight: '700' },
  pickButtonSolid: { minHeight: 36, paddingHorizontal: 16, borderRadius: 18, backgroundColor: Elite.green, justifyContent: 'center' },
  pickButtonSolidText: { color: Elite.deep, fontSize: 13, fontWeight: '800' },
  joinCard: { gap: 10 },
  label: { color: Elite.faint, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  input: { height: 46, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', backgroundColor: Elite.cell, color: Elite.cream, paddingHorizontal: 12, fontFamily: ANTON, fontSize: 20, letterSpacing: 4 },
  primary: { minHeight: 48, borderRadius: 14, backgroundColor: Elite.green, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: Elite.deep, fontSize: 15, fontWeight: '800' },
  disabled: { opacity: 0.5 },
  actions: { flexDirection: 'row', gap: 10 },
  action: { flex: 1, minHeight: 50, borderRadius: 14, backgroundColor: Elite.card, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  actionGreen: { borderColor: 'rgba(57,255,20,0.5)' },
  actionText: { color: Elite.cream, fontSize: 14, fontWeight: '800' },
});
