import { Redirect, router, useLocalSearchParams, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { BigButton, GroupTitle, PageTitle, SmallButton, TONES, formatWhen } from '@/components/commissioner/CommishParts';
import { MirrorBanner } from '@/components/MirrorBanner';
import { Text } from '@/components/Text';
import { LoadingState } from '@/components/ui';
import { THEM, YOU, leanFor, pos, verdictFor } from '@/components/trades/TradeParts';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { trackTap } from '@/lib/analytics';
import { useAppearance } from '@/lib/appearance';
import { haptics } from '@/lib/haptics';
import { refreshTrades, useLeagueTrades, useMe, useMyTrades, useTradeBlock, useTradeRoster, useTradeTeams } from '@/lib/queries';
import type { Trade, TradeSettings, TradeStatus } from '@/lib/types';

// Trades (2026-10-23 overhaul, mockup 4): the inbox. Offers to you with a
// read on whether they're good for you, your own offers, the trade block
// (players owners say they'd move) and what's happening around the league.
// Building a trade is its own screen (trade-builder.tsx), and so is an
// offer (trade/[id].tsx).

const STATUS_LABEL: Record<TradeStatus, string> = {
  pending: 'Waiting for an answer',
  awaiting_review: 'Waiting on the commissioner',
  in_review: 'In review',
  accepted: 'Went through',
  rejected: 'Declined',
  cancelled: 'Withdrawn',
  vetoed: 'Vetoed',
  expired: 'Expired',
  failed: "Couldn't go through",
};

function untilText(iso: string | null | undefined, now: number): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return null;
  const h = Math.floor(ms / 3_600_000);
  return h >= 48 ? `${Math.floor(h / 24)} days` : h >= 1 ? `${h}h` : `${Math.max(1, Math.floor(ms / 60_000))}m`;
}

function deadlineLine(s: TradeSettings | null, now: number): string | undefined {
  if (!s) return undefined;
  if (!s.trade_deadline) return 'No trade deadline this season';
  const left = untilText(s.trade_deadline, now);
  return left ? `Deadline in ${left} · ${formatWhen(s.trade_deadline)}` : 'The trade deadline has passed';
}

function reviewLine(s: TradeSettings | null): string | null {
  if (!s) return null;
  const hrs = `${s.review_hours} hour${s.review_hours === 1 ? '' : 's'}`;
  switch (s.review_mode) {
    case 'none':
      return 'Trades go through as soon as they’re accepted.';
    case 'commissioner':
      return `Accepted trades wait ${hrs} for the commissioner, then go through.`;
    case 'league_vote':
      return `Accepted trades wait ${hrs}; ${s.effective_veto_votes_needed} veto votes stop one.`;
    default:
      return 'Accepted trades wait for the commissioner to approve them.';
  }
}

function getsFor(trade: Trade, teamId: number): string {
  const players = trade.assets.filter((a) => a.to_team_id === teamId).map((a) => a.player_name);
  const picks = (trade.picks ?? []).filter((p) => p.to_team_id === teamId).map((p) => `${p.label} pick`);
  return [...players, ...picks].join(', ') || '—';
}

function nowMs(): number {
  return Date.now();
}

export default function TradesScreen() {
  // Older links (a player's "Propose trade") open the builder.
  const params = useLocalSearchParams<{ team?: string; player?: string }>();
  if (params.team)
    return <Redirect href={`/trade-builder?team=${params.team}${params.player ? `&player=${encodeURIComponent(params.player)}` : ''}` as Href} />;
  return <TradesInbox />;
}

function TradesInbox() {
  const accent = useAppearance().accent;
  const me = useMe().data;
  const teams = useTradeTeams();
  const mine = useMyTrades();
  const league = useLeagueTrades();
  const block = useTradeBlock();
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = nowMs();

  const myTeam = (teams.data ?? []).find((t) => t.owner_id === me?.owner_id) ?? null;
  const myTeamId = myTeam?.team_id ?? -1;
  const settings = league.data?.settings ?? null;
  const trades = mine.data ?? [];
  const toMe = trades.filter((t) => t.status === 'pending' && t.receiving_team_id === myTeamId);
  const fromMe = trades.filter((t) => t.status === 'pending' && t.proposing_team_id === myTeamId);
  const inReview = trades.filter((t) => t.status === 'in_review' || t.status === 'awaiting_review');
  const past = trades.filter((t) => !['pending', 'in_review', 'awaiting_review'].includes(t.status)).slice(0, 8);
  const around = (league.data?.trades ?? []).filter((t) => t.proposing_team_id !== myTeamId && t.receiving_team_id !== myTeamId);

  async function onRefresh() {
    setRefreshing(true);
    await Promise.all([teams.refetch(), mine.refetch(), league.refetch(), block.refetch()]);
    setRefreshing(false);
  }

  async function withdraw(t: Trade) {
    setBusyId(t.id);
    setError(null);
    try {
      await api.tradeAction(t.id, 'cancel');
      haptics.success();
      refreshTrades();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t go through.');
    } finally {
      setBusyId(null);
    }
  }

  async function vote(t: Trade) {
    setBusyId(t.id);
    setError(null);
    try {
      await api.vetoVote(t.id, !t.my_veto_vote);
      haptics.success();
      refreshTrades();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t go through.');
    } finally {
      setBusyId(null);
    }
  }

  if (teams.isPending || mine.isPending) return <LoadingState />;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={accent} />}>
      <PageTitle title="Trades" subtitle={deadlineLine(settings, now)} />
      <MirrorBanner />
      <BigButton
        label="Build a trade"
        onPress={() => {
          trackTap('trades.build');
          router.push('/trade-builder' as Href);
        }}
      />
      {reviewLine(settings) && <Text style={styles.soft}>{reviewLine(settings)}</Text>}
      {error && <Text style={styles.error}>{error}</Text>}

      {toMe.length > 0 && (
        <View style={styles.section}>
          <GroupTitle title={`Offers to you · ${toMe.length}`} color={accent} />
          {toMe.map((t) => {
            const v = t.value ? verdictFor(t.value.value_change) : null;
            const left = untilText(t.expires_at, now);
            return (
              <Pressable
                key={t.id}
                onPress={() => router.push(`/trade/${t.id}` as Href)}
                accessibilityRole="button"
                accessibilityLabel={`Offer from ${t.proposing_team_name}. Review`}
                style={({ pressed }) => [styles.card, { borderColor: `${accent}55` }, pressed && styles.pressed]}>
                <View style={styles.row}>
                  <Text style={styles.meta}>From {t.proposing_team_name}</Text>
                  {left && <Text style={[styles.meta, { color: TONES.yellow, fontWeight: '700' }]}>Expires in {left}</Text>}
                </View>
                <View style={styles.sides}>
                  <View style={styles.side}>
                    <Text style={styles.kicker}>You get</Text>
                    <Text style={styles.names}>{getsFor(t, myTeamId)}</Text>
                  </View>
                  <View style={styles.side}>
                    <Text style={styles.kicker}>You give</Text>
                    <Text style={styles.names}>{getsFor(t, t.proposing_team_id)}</Text>
                  </View>
                </View>
                <View style={styles.row}>
                  {v ? <Text style={[styles.verdict, { color: v.color }]}>{v.text}</Text> : <View />}
                  <Text style={[styles.link, { color: accent }]}>Review ›</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}

      {fromMe.length > 0 && (
        <View style={styles.section}>
          <GroupTitle title={`Your offers · ${fromMe.length}`} color={YOU} />
          {fromMe.map((t) => (
            <Pressable key={t.id} onPress={() => router.push(`/trade/${t.id}` as Href)} style={({ pressed }) => [styles.card, styles.rowCard, pressed && styles.pressed]}>
              <View style={styles.flex}>
                <Text style={styles.names}>
                  {getsFor(t, t.receiving_team_id)} for {getsFor(t, myTeamId)}
                </Text>
                <Text style={styles.meta}>
                  To {t.receiving_team_name}
                  {untilText(t.expires_at, now) ? ` · expires in ${untilText(t.expires_at, now)}` : ''}
                </Text>
              </View>
              <SmallButton label={busyId === t.id ? 'Working…' : 'Withdraw'} color={THEM} disabled={busyId === t.id} onPress={() => withdraw(t)} />
            </Pressable>
          ))}
        </View>
      )}

      {inReview.length > 0 && (
        <View style={styles.section}>
          <GroupTitle title="Accepted, in review" color={TONES.yellow} />
          {inReview.map((t) => (
            <Pressable key={t.id} onPress={() => router.push(`/trade/${t.id}` as Href)} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
              <Text style={styles.names}>
                {t.proposing_team_name} ↔ {t.receiving_team_name}
              </Text>
              <Text style={styles.meta}>
                {t.status === 'in_review' && t.review_ends_at ? `Goes through ${formatWhen(t.review_ends_at)} unless vetoed` : STATUS_LABEL[t.status]}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      <TradeBlockSection myTeamId={myTeamId} />

      {around.length > 0 && (
        <View style={styles.section}>
          <GroupTitle title="Around the league" color={Colors.textSecondary} />
          {around.map((t) => {
            const canVote = t.status === 'in_review' && settings?.review_mode === 'league_vote';
            const lean = leanFor(t);
            return (
              <View key={t.id} style={styles.feedRow}>
                <Text style={styles.body}>
                  {t.proposing_team_name} get {getsFor(t, t.proposing_team_id)} · {t.receiving_team_name} get {getsFor(t, t.receiving_team_id)}
                </Text>
                <Text style={styles.meta}>
                  {t.status === 'in_review' && t.review_ends_at ? `In review · goes through ${formatWhen(t.review_ends_at)}` : STATUS_LABEL[t.status]}
                  {lean ? ` · ${lean}` : ''}
                  {canVote ? ` · ${t.veto_votes ?? 0} of ${settings?.effective_veto_votes_needed} veto votes` : ''}
                </Text>
                {canVote && (
                  <View style={styles.inline}>
                    <SmallButton
                      label={busyId === t.id ? 'Working…' : t.my_veto_vote ? 'Take back veto vote' : 'Vote to veto'}
                      color={TONES.red}
                      disabled={busyId === t.id}
                      onPress={() => vote(t)}
                    />
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}

      {past.length > 0 && (
        <View style={styles.section}>
          <GroupTitle title="Your past trades" color={Colors.textSecondary} />
          {past.map((t) => {
            const other = t.proposing_team_id === myTeamId ? t.receiving_team_name : t.proposing_team_name;
            return (
              <Pressable key={t.id} onPress={() => router.push(`/trade/${t.id}` as Href)} style={styles.feedRow}>
                <Text style={styles.body}>
                  With {other}: got {getsFor(t, myTeamId)}
                </Text>
                <Text style={styles.meta}>
                  {STATUS_LABEL[t.status]}
                  {t.resolved_at ? ` · ${formatWhen(t.resolved_at)}` : ''}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

function TradeBlockSection({ myTeamId }: { myTeamId: number }) {
  const block = useTradeBlock().data ?? [];
  const myRoster = useTradeRoster(myTeamId > 0 ? myTeamId : null).data ?? [];
  const [listing, setListing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const others = block.filter((b) => b.team_id !== myTeamId);
  const mineListed = block.filter((b) => b.team_id === myTeamId);
  const listedIds = new Set(mineListed.map((b) => b.sleeper_player_id));

  async function toggleListing(id: string, listed: boolean) {
    setError(null);
    try {
      if (listed) await api.removeFromTradeBlock(id);
      else await api.addToTradeBlock(id);
      haptics.select();
      refreshTrades();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t go through.');
    }
  }

  return (
    <View style={styles.section}>
      <GroupTitle title="Trade block" color={TONES.purple} />
      <Text style={styles.soft}>Players their owners say they’d move. Tap one to start a trade.</Text>
      {error && <Text style={styles.error}>{error}</Text>}
      <View style={styles.chips}>
        {others.map((b) => (
          <Pressable
            key={`${b.team_id}-${b.sleeper_player_id}`}
            onPress={() => router.push(`/trade-builder?team=${b.team_id}&player=${encodeURIComponent(b.sleeper_player_id)}` as Href)}
            accessibilityRole="button"
            accessibilityLabel={`${b.player_name} from ${b.team_name}. Start a trade`}
            style={({ pressed }) => [styles.chip, pressed && styles.pressed]}>
            <Text style={styles.chipName}>{b.player_name}</Text>
            <Text style={styles.chipSub}>
              {pos(b.position)} · {b.per_week.toFixed(1)}/wk · {b.team_name}
            </Text>
          </Pressable>
        ))}
        {mineListed.map((b) => (
          <Pressable
            key={`mine-${b.sleeper_player_id}`}
            onPress={() => toggleListing(b.sleeper_player_id, true)}
            accessibilityRole="button"
            accessibilityLabel={`Take ${b.player_name} off the block`}
            style={[styles.chip, { borderColor: `${TONES.purple}88` }]}>
            <Text style={styles.chipName}>{b.player_name} ✕</Text>
            <Text style={styles.chipSub}>Yours · tap to take off</Text>
          </Pressable>
        ))}
        <Pressable onPress={() => setListing((v) => !v)} accessibilityRole="button" style={[styles.chip, styles.addChip]}>
          <Text style={[styles.chipName, { color: TONES.purple }]}>{listing ? 'Done' : '+ List one of yours'}</Text>
        </Pressable>
      </View>
      {others.length === 0 && mineListed.length === 0 && !listing && <Text style={styles.meta}>Nobody has listed anyone yet.</Text>}
      {listing && (
        <View style={styles.chips}>
          {myRoster
            .filter((p) => !listedIds.has(p.sleeper_player_id))
            .map((p) => (
              <Pressable key={p.sleeper_player_id} onPress={() => toggleListing(p.sleeper_player_id, false)} style={styles.chip} accessibilityRole="button">
                <Text style={styles.chipName}>{p.player_name}</Text>
                <Text style={styles.chipSub}>
                  {pos(p.position)} · {(p.per_week ?? 0).toFixed(1)}/wk
                </Text>
              </Pressable>
            ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xl * 2, gap: Spacing.lg },
  section: { gap: Spacing.sm },
  soft: { color: 'rgba(255,255,255,0.7)', fontSize: 14 },
  body: { color: Colors.text, fontSize: 14, fontWeight: '600' },
  meta: { color: Colors.textSecondary, fontSize: 12 },
  error: { color: Colors.loss, fontSize: 14 },
  kicker: { color: Colors.textSecondary, fontSize: 11, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase' },
  card: { backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', padding: Spacing.md, gap: Spacing.sm },
  rowCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  pressed: { opacity: 0.8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.sm },
  sides: { flexDirection: 'row', gap: Spacing.md },
  side: { flex: 1, gap: 4 },
  names: { color: Colors.text, fontSize: 14, fontWeight: '700' },
  verdict: { fontSize: 13, fontWeight: '800', flexShrink: 1 },
  link: { fontSize: 13, fontWeight: '700' },
  flex: { flex: 1, gap: 3 },
  feedRow: { gap: 3, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.08)' },
  inline: { flexDirection: 'row', marginTop: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: Radius.md, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', backgroundColor: Colors.surface },
  addChip: { borderStyle: 'dashed', borderColor: TONES.purple, backgroundColor: 'transparent' },
  chipName: { color: Colors.text, fontSize: 13, fontWeight: '700' },
  chipSub: { color: Colors.textSecondary, fontSize: 11 },
});
