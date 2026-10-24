import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { BigButton, PageTitle, TONES, formatWhen } from '@/components/commissioner/CommishParts';
import { Text } from '@/components/Text';
import { LoadingState, MessageState } from '@/components/ui';
import { ShareableCard } from '@/components/ShareableCard';
import { DropPicker, LineupChange, THEM, YOU, leanFor, pos, verdictFor } from '@/components/trades/TradeParts';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { trackTap } from '@/lib/analytics';
import { haptics } from '@/lib/haptics';
import { invalidateRosterMoves, refreshTrades, useLeagueTrades, useMe, useMyTrades, useTradeEvaluation, useTradeTeams } from '@/lib/queries';
import type { Trade, TradeEvaluation } from '@/lib/types';

// One trade (2026-10-23 overhaul, mockup 6). An offer to you: what you'd
// get and give with each player's points a week, your starting lineup
// before → after, who you'd drop if it's a 2-for-1, then Accept, Counter
// or Decline. Your own offer: withdraw it. Anyone else's: what happened.

function ShareCardIf({ when, title, children }: { when: boolean; title: string; children: ReactNode }) {
  return when ? <ShareableCard title={title}>{children}</ShareableCard> : <>{children}</>;
}

const STATUS_LINE: Partial<Record<Trade['status'], string>> = {
  accepted: 'This trade went through.',
  rejected: 'This offer was declined.',
  cancelled: 'This offer was withdrawn.',
  vetoed: 'This trade was vetoed.',
  expired: 'This offer expired.',
  failed: 'A player in it moved before it could go through.',
  awaiting_review: 'Accepted. Waiting on the commissioner to approve it.',
};

export default function TradeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const tradeId = Number(id);
  const me = useMe().data;
  const teams = useTradeTeams();
  const mine = useMyTrades();
  const league = useLeagueTrades();
  const trade = [...(mine.data ?? []), ...(league.data?.trades ?? [])].find((t) => t.id === tradeId) ?? null;
  const myTeamId = (teams.data ?? []).find((t) => t.owner_id === me?.owner_id)?.team_id ?? null;
  const involved = trade !== null && myTeamId !== null && (trade.proposing_team_id === myTeamId || trade.receiving_team_id === myTeamId);
  const evaluation = useTradeEvaluation(involved ? tradeId : null);

  if (mine.isPending || teams.isPending) return <LoadingState />;
  if (!trade) return <MessageState message="That trade isn't around any more." />;
  return <TradeDetail trade={trade} myTeamId={myTeamId} evaluation={involved ? (evaluation.data ?? null) : null} />;
}

function TradeDetail({ trade, myTeamId, evaluation }: { trade: Trade; myTeamId: number | null; evaluation: TradeEvaluation | null }) {
  const [drops, setDrops] = useState<string[]>([]);
  const [busy, setBusy] = useState<'accept' | 'reject' | 'cancel' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toMe = trade.receiving_team_id === myTeamId;
  const fromMe = trade.proposing_team_id === myTeamId;
  const other = toMe ? trade.proposing_team_name : trade.receiving_team_name;
  const title = toMe ? `Offer from ${other}` : fromMe ? `Your offer to ${other}` : `${trade.proposing_team_name} ↔ ${trade.receiving_team_name}`;
  const pending = trade.status === 'pending';
  const needed = evaluation?.my_drops_needed ?? 0;
  const myDrops = (trade.drops ?? []).filter((d) => d.team_id === myTeamId);

  const subtitle = pending
    ? `Sent ${formatWhen(trade.proposed_at)}${trade.expires_at ? ` · expires ${formatWhen(trade.expires_at)}` : ''}`
    : trade.status === 'in_review' && trade.review_ends_at
      ? `In review · goes through ${formatWhen(trade.review_ends_at)} unless vetoed`
      : STATUS_LINE[trade.status];

  async function act(action: 'accept' | 'reject' | 'cancel') {
    setBusy(action);
    setError(null);
    try {
      if (action === 'accept') await api.acceptTrade(trade.id, drops);
      else await api.tradeAction(trade.id, action);
      haptics.success();
      refreshTrades();
      if (action === 'accept') invalidateRosterMoves();
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t go through.');
    } finally {
      setBusy(null);
    }
  }

  const sideGets = (teamId: number) => trade.assets.filter((a) => a.to_team_id === teamId);
  const valueOf = (pid: string) =>
    [...(evaluation?.give ?? []), ...(evaluation?.receive ?? [])].find((p) => p.id === pid)?.per_week ?? null;
  const left = myTeamId !== null && (toMe || fromMe) ? myTeamId : trade.proposing_team_id;
  const right = left === trade.proposing_team_id ? trade.receiving_team_id : trade.proposing_team_id;
  const v = evaluation ? verdictFor(evaluation.value_change) : null;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
      <PageTitle title={title} subtitle={subtitle} />

      {trade.note ? (
        <View style={styles.card}>
          <Text style={styles.kicker}>Their note</Text>
          <Text style={styles.body}>“{trade.note}”</Text>
        </View>
      ) : null}

      {/* A deal that's done (or in review) can go to the group chat (2026-10-24). */}
      <ShareCardIf when={['accepted', 'in_review', 'awaiting_review'].includes(trade.status)} title={`Trade: ${trade.proposing_team_name} ↔ ${trade.receiving_team_name}`}>
      <View style={styles.sides}>
        {[left, right].map((teamId, i) => {
          const color = i === 0 ? YOU : THEM;
          const label = toMe || fromMe ? (i === 0 ? 'You get' : 'You give') : `${teamId === trade.proposing_team_id ? trade.proposing_team_name : trade.receiving_team_name} get`;
          return (
            <View key={teamId} style={[styles.card, styles.side, { borderColor: `${color}55` }]}>
              <Text style={[styles.kicker, { color }]}>{label}</Text>
              {sideGets(teamId).map((a) => {
                const value = valueOf(a.sleeper_player_id);
                return (
                  <View key={a.sleeper_player_id}>
                    <Text style={styles.name}>{a.player_name}</Text>
                    <Text style={styles.meta}>
                      {pos(a.position)}
                      {value !== null ? ` · ${value.toFixed(1)}/wk` : ''}
                    </Text>
                  </View>
                );
              })}
            </View>
          );
        })}
      </View>

      {v && <Text style={[styles.verdict, { color: v.color }]}>{v.text}</Text>}
      {!v && leanFor(trade) && <Text style={[styles.verdict, { color: TONES.yellow }]}>{leanFor(trade)}</Text>}
      </ShareCardIf>
      {evaluation && (toMe || fromMe) && <LineupChange lineup={evaluation.my_lineup} />}

      {myDrops.length > 0 && (
        <Text style={styles.meta}>You’ll drop {myDrops.map((d) => d.player_name).join(', ')} when it goes through.</Text>
      )}

      {pending && toMe && evaluation && (
        <DropPicker
          needed={needed}
          candidates={evaluation.drop_candidates}
          selected={drops}
          onToggle={(id) => setDrops((d) => (d.includes(id) ? d.filter((x) => x !== id) : [...d, id]))}
        />
      )}

      {error && <Text style={styles.error}>{error}</Text>}

      {pending && toMe && (
        <View style={styles.actions}>
          <BigButton label="Accept" busyLabel="Accepting…" busy={busy === 'accept'} disabled={busy !== null || drops.length < needed} onPress={() => act('accept')} />
          <View style={styles.pair}>
            <View style={styles.flex}>
              <BigButton
                label="Counter"
                tone="outline"
                disabled={busy !== null}
                onPress={() => {
                  trackTap('trades.counter');
                  router.push(`/trade-builder?counter=${trade.id}` as Href);
                }}
              />
            </View>
            <View style={styles.flex}>
              <BigButton label="Decline" busyLabel="Declining…" tone="danger" busy={busy === 'reject'} disabled={busy !== null} onPress={() => act('reject')} />
            </View>
          </View>
        </View>
      )}
      {pending && fromMe && (
        <BigButton label="Withdraw offer" busyLabel="Withdrawing…" tone="danger" busy={busy === 'cancel'} disabled={busy !== null} onPress={() => act('cancel')} />
      )}
      {trade.status === 'in_review' && (toMe || fromMe) && (
        <Text style={[styles.meta, { color: TONES.yellow }]}>Accepted. The league can still review it before it goes through.</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xl * 2, gap: Spacing.md },
  card: { backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', padding: Spacing.md, gap: 6 },
  kicker: { color: Colors.textSecondary, fontSize: 11, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase' },
  body: { color: Colors.text, fontSize: 14, lineHeight: 20 },
  sides: { flexDirection: 'row', gap: 10 },
  side: { flex: 1 },
  name: { color: Colors.text, fontSize: 15, fontWeight: '700' },
  meta: { color: Colors.textSecondary, fontSize: 12 },
  verdict: { fontSize: 15, fontWeight: '800' },
  error: { color: Colors.loss, fontSize: 14 },
  actions: { gap: 8 },
  pair: { flexDirection: 'row', gap: 8 },
  flex: { flex: 1 },
});
