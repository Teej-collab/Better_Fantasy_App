import * as Haptics from 'expo-haptics';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { NeonPanel } from '@/components/NeonPanel';
import { Display, Text } from '@/components/Text';
import { LoadingState } from '@/components/ui';
import { Colors, Radius, SectionColors, Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { useAppearance } from '@/lib/appearance';
import { invalidateRosterMoves, queryClient, useMe, useMyTrades, useTradeRoster, useTradeTeams } from '@/lib/queries';
import type { Trade, TradeRosterPlayer, TradeStatus } from '@/lib/types';

const STATUS_LABEL: Record<TradeStatus, string> = {
  pending: 'Pending',
  awaiting_review: 'Awaiting commissioner review',
  accepted: 'Accepted',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  vetoed: 'Vetoed',
};

const STATUS_COLOR: Record<TradeStatus, string> = {
  pending: '#fbbf24',
  awaiting_review: '#fbbf24',
  accepted: '#34d399',
  rejected: 'rgba(255,255,255,0.5)',
  cancelled: 'rgba(255,255,255,0.5)',
  vetoed: '#ef4444',
};

// Port of the web's /trades (TradesApp.tsx): propose a trade to another
// team, then accept / reject / cancel from your trade list.
export default function TradesScreen() {
  const accent = useAppearance().accent;
  const me = useMe().data;
  const teams = useTradeTeams();
  const trades = useMyTrades();
  const [partnerId, setPartnerId] = useState<number | null>(null);
  const [give, setGive] = useState<Set<string>>(new Set());
  const [receive, setReceive] = useState<Set<string>>(new Set());
  const [proposing, setProposing] = useState(false);
  const [proposeError, setProposeError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const myTeam = (teams.data ?? []).find((t) => t.owner_id === me?.owner_id) ?? null;
  const otherTeams = (teams.data ?? []).filter((t) => t.owner_id !== me?.owner_id);
  const teamNameById = new Map((teams.data ?? []).map((t) => [t.team_id, t.team_name]));
  const myRoster = useTradeRoster(myTeam?.team_id ?? null).data ?? [];
  const theirRoster = useTradeRoster(partnerId).data ?? [];

  function choosePartner(teamId: number) {
    setPartnerId(teamId);
    setReceive(new Set());
  }

  function toggle(set: Set<string>, update: (s: Set<string>) => void, id: string) {
    void Haptics.selectionAsync();
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    update(next);
  }

  async function propose() {
    if (partnerId === null || give.size === 0 || receive.size === 0) return;
    setProposing(true);
    setProposeError(null);
    try {
      await api.proposeTrade(partnerId, [...give], [...receive]);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setGive(new Set());
      setReceive(new Set());
      setPartnerId(null);
      void queryClient.invalidateQueries({ queryKey: ['my-trades'] });
    } catch (e) {
      setProposeError(e instanceof Error ? e.message : "Couldn't propose that trade.");
    } finally {
      setProposing(false);
    }
  }

  async function act(trade: Trade, action: 'accept' | 'reject' | 'cancel') {
    setBusyId(trade.id);
    setError(null);
    try {
      await api.tradeAction(trade.id, action);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      void queryClient.invalidateQueries({ queryKey: ['my-trades'] });
      // An accepted trade moves players between rosters.
      if (action === 'accept') {
        invalidateRosterMoves();
        void queryClient.invalidateQueries({ queryKey: ['trade-roster'] });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That action failed.');
    } finally {
      setBusyId(null);
    }
  }

  async function onRefresh() {
    setRefreshing(true);
    await Promise.all([teams.refetch(), trades.refetch()]);
    setRefreshing(false);
  }

  if (teams.isPending) return <LoadingState />;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={accent} />}>
      <Stack.Screen options={{ title: 'Trades' }} />
      <Display style={styles.title}>Trades</Display>
      {error && <Text style={styles.error}>{error}</Text>}

      <NeonPanel color={SectionColors.trades} contentStyle={styles.gap}>
        <Text style={styles.heading}>Propose a trade</Text>
        {otherTeams.length === 0 ? (
          <Text style={styles.muted}>No other teams in this league yet.</Text>
        ) : (
          <>
            <View style={styles.chips}>
              {otherTeams.map((t) => {
                const active = partnerId === t.team_id;
                return (
                  <Pressable
                    key={t.team_id}
                    onPress={() => choosePartner(t.team_id)}
                    style={[styles.chip, active && { backgroundColor: accent, borderColor: accent }]}>
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{t.team_name}</Text>
                  </Pressable>
                );
              })}
            </View>
            {partnerId !== null && (
              <>
                <PlayerPicker title="You give" players={myRoster} selected={give} onToggle={(id) => toggle(give, setGive, id)} />
                <PlayerPicker
                  title="You receive"
                  players={theirRoster}
                  selected={receive}
                  onToggle={(id) => toggle(receive, setReceive, id)}
                />
                {proposeError && <Text style={styles.error}>{proposeError}</Text>}
                <Pressable
                  onPress={propose}
                  disabled={give.size === 0 || receive.size === 0 || proposing}
                  style={[styles.primary, { backgroundColor: accent }, (give.size === 0 || receive.size === 0 || proposing) && styles.disabled]}>
                  {proposing ? <ActivityIndicator color="#000" /> : <Text style={styles.primaryText}>Propose trade</Text>}
                </Pressable>
              </>
            )}
          </>
        )}
      </NeonPanel>

      <View style={styles.gap}>
        <Text style={styles.heading}>My trades</Text>
        {trades.isPending ? (
          <LoadingState />
        ) : (trades.data ?? []).length === 0 ? (
          <Text style={styles.muted}>No trades yet.</Text>
        ) : (
          <NeonPanel color={SectionColors.trades} contentStyle={styles.list}>
            {(trades.data ?? []).map((t, i) => (
              <TradeRow
                key={t.id}
                trade={t}
                divided={i > 0}
                myTeamId={myTeam?.team_id ?? null}
                teamNameById={teamNameById}
                busy={busyId === t.id}
                onAction={(action) => act(t, action)}
              />
            ))}
          </NeonPanel>
        )}
      </View>
    </ScrollView>
  );
}

function PlayerPicker(props: { title: string; players: TradeRosterPlayer[]; selected: Set<string>; onToggle: (id: string) => void }) {
  const accent = useAppearance().accent;
  return (
    <View style={styles.gapSm}>
      <Text style={styles.small}>{props.title}</Text>
      {props.players.length === 0 ? (
        <Text style={styles.muted}>No players.</Text>
      ) : (
        props.players.map((p) => {
          const on = props.selected.has(p.sleeper_player_id);
          return (
            <Pressable
              key={p.sleeper_player_id}
              onPress={() => props.onToggle(p.sleeper_player_id)}
              style={[styles.pickRow, on && { backgroundColor: `${accent}33`, borderColor: accent }]}>
              <Text style={styles.body}>{p.player_name}</Text>
              <Text style={on ? styles.body : styles.muted}>{p.position === 'DEF' ? 'D/ST' : p.position}</Text>
            </Pressable>
          );
        })
      )}
    </View>
  );
}

function TradeRow(props: {
  trade: Trade;
  divided: boolean;
  myTeamId: number | null;
  teamNameById: Map<number, string>;
  busy: boolean;
  onAction: (action: 'accept' | 'reject' | 'cancel') => void;
}) {
  const accent = useAppearance().accent;
  const { trade } = props;
  const isProposer = props.myTeamId !== null && trade.proposing_team_id === props.myTeamId;
  const isReceiver = props.myTeamId !== null && trade.receiving_team_id === props.myTeamId;
  const give = trade.assets.filter((a) => a.from_team_id === trade.proposing_team_id);
  const receive = trade.assets.filter((a) => a.from_team_id === trade.receiving_team_id);
  const other = props.teamNameById.get(isProposer ? trade.receiving_team_id : trade.proposing_team_id) ?? '—';

  return (
    <View style={[styles.trade, props.divided && styles.divided]}>
      <View style={styles.tradeHead}>
        <Text style={styles.tradeTitle}>{isProposer ? `To ${other}` : `From ${other}`}</Text>
        <Text style={[styles.status, { color: STATUS_COLOR[trade.status] }]}>{STATUS_LABEL[trade.status]}</Text>
      </View>
      <View style={styles.sides}>
        <View style={styles.side}>
          <Text style={styles.small}>{isProposer ? 'You give' : 'They give'}</Text>
          <Text style={styles.soft}>{give.map((a) => a.player_name).join(', ') || '—'}</Text>
        </View>
        <View style={styles.side}>
          <Text style={styles.small}>{isProposer ? 'You receive' : 'They receive'}</Text>
          <Text style={styles.soft}>{receive.map((a) => a.player_name).join(', ') || '—'}</Text>
        </View>
      </View>
      {trade.status === 'pending' && isReceiver && (
        <View style={styles.actions}>
          <Pressable disabled={props.busy} onPress={() => props.onAction('accept')} style={[styles.action, { backgroundColor: accent, borderColor: accent }]}>
            <Text style={styles.actionTextDark}>{props.busy ? 'Working…' : 'Accept'}</Text>
          </Pressable>
          <Pressable disabled={props.busy} onPress={() => props.onAction('reject')} style={styles.action}>
            <Text style={styles.actionText}>Reject</Text>
          </Pressable>
        </View>
      )}
      {trade.status === 'pending' && isProposer && (
        <View style={styles.actions}>
          <Pressable disabled={props.busy} onPress={() => props.onAction('cancel')} style={styles.action}>
            <Text style={styles.actionText}>{props.busy ? 'Working…' : 'Cancel'}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xl * 2, gap: Spacing.lg },
  title: { fontSize: 24, textTransform: 'none', letterSpacing: 0 },
  gap: { gap: Spacing.md },
  gapSm: { gap: 6 },
  heading: { color: Colors.text, fontSize: 16, fontWeight: '500' },
  body: { color: Colors.text, fontSize: 14 },
  soft: { color: 'rgba(255,255,255,0.7)', fontSize: 14 },
  muted: { color: 'rgba(255,255,255,0.5)', fontSize: 14 },
  small: { color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase' },
  error: { color: Colors.loss, fontSize: 14 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderRadius: Radius.pill, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 12, paddingVertical: 6 },
  chipText: { color: Colors.text, fontSize: 12 },
  chipTextActive: { color: '#06110a', fontWeight: '600' },
  pickRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  primary: { alignSelf: 'flex-start', borderRadius: Radius.pill, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, minWidth: 140, alignItems: 'center' },
  primaryText: { color: '#000', fontSize: 14, fontWeight: '600' },
  disabled: { opacity: 0.4 },
  list: { padding: 0, backgroundColor: 'rgba(18,22,28,0.92)' },
  trade: { padding: Spacing.lg, gap: Spacing.sm },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.06)' },
  tradeHead: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: Spacing.sm },
  tradeTitle: { color: Colors.text, fontSize: 14, fontWeight: '500' },
  status: { fontSize: 12, fontWeight: '600' },
  sides: { gap: Spacing.sm },
  side: { gap: 2 },
  actions: { flexDirection: 'row', gap: Spacing.sm },
  action: { borderRadius: Radius.pill, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 12, paddingVertical: 6 },
  actionText: { color: Colors.text, fontSize: 12 },
  actionTextDark: { color: '#06110a', fontSize: 12, fontWeight: '600' },
});
