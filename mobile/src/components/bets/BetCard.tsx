import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Text';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { formatMoney, formatOdds, formatStat, legPick } from '@/lib/bets';
import type { Bet, BetLeg, BetStatus } from '@/lib/types';

// One bet slip with every leg's live progress — the same card on My
// Bets, the Gamecast's Your Bets panel, and a bet shared to league chat
// (port of the web's components/bets/BetCard.tsx).

const STATUS: Record<BetStatus, { label: string; color: string }> = {
  open: { label: 'Live', color: '#38bdf8' },
  won: { label: 'Won', color: '#22c55e' },
  lost: { label: 'Lost', color: '#ef4444' },
  push: { label: 'Push', color: Colors.textSecondary },
  void: { label: 'Void', color: Colors.textSecondary },
  cashed_out: { label: 'Cashed out', color: '#f59e0b' },
};

export function BetStatusPill({ status }: { status: BetStatus }) {
  const s = STATUS[status];
  return (
    <View style={[styles.pill, { backgroundColor: `${s.color}26` }]}>
      <Text style={[styles.pillText, { color: s.color }]} maxFontSizeMultiplier={1.3}>
        {s.label}
      </Text>
    </View>
  );
}

export function BetCard({
  bet,
  shared = false,
  onlyEventId,
  footer,
}: {
  bet: Bet;
  // Shown to someone other than the bettor: names them, hides the money.
  shared?: boolean;
  // Gamecast: the legs riding on this game stand out, the rest dim.
  onlyEventId?: string;
  footer?: ReactNode;
}) {
  const parlay = bet.legs.length > 1;
  const settled = bet.legs.filter((l) => l.status !== 'open').length;
  const showMoney = !shared && (bet.stake != null || bet.payout != null);
  return (
    <View style={styles.card}>
      <View style={styles.top}>
        <View style={styles.flex}>
          <Text style={styles.kicker}>
            {shared ? `${bet.owner_name}'s ` : ''}
            {parlay ? `${bet.legs.length}-leg parlay` : 'Straight bet'}
            {bet.sportsbook ? ` · ${bet.sportsbook}` : ''}
          </Text>
          {parlay && bet.status === 'open' && (
            <Text style={styles.muted}>
              {settled} of {bet.legs.length} legs settled
            </Text>
          )}
        </View>
        {bet.odds_american !== null && <Text style={styles.odds}>{formatOdds(bet.odds_american)}</Text>}
        <BetStatusPill status={bet.status} />
      </View>

      {bet.legs.map((leg) => (
        <LegRow key={leg.id} leg={leg} dim={onlyEventId !== undefined && leg.espn_event_id !== onlyEventId} />
      ))}

      {showMoney && (
        <View style={styles.money}>
          <Text style={styles.muted}>Wager {formatMoney(bet.stake)}</Text>
          <Text style={styles.muted}>
            {bet.status === 'won' ? 'Paid' : 'To pay'} <Text style={styles.moneyStrong}>{formatMoney(bet.payout)}</Text>
          </Text>
        </View>
      )}
      {footer}
    </View>
  );
}

function LegRow({ leg, dim }: { leg: BetLeg; dim: boolean }) {
  const pct = leg.tracked && leg.current !== null && leg.target ? Math.max(0, Math.min(1, leg.current / leg.target)) : null;
  const icon =
    leg.status === 'won' ? '✅' : leg.status === 'lost' ? '❌' : leg.status === 'push' || leg.status === 'void' ? '➖' : '⏳';
  const barColor =
    leg.status === 'won' ? Colors.win : leg.status === 'lost' ? Colors.loss : leg.direction === 'under' ? '#f59e0b' : '#38bdf8';
  const pick = `${leg.player_name ? `${leg.player_name} — ` : ''}${legPick(leg)}`;
  const progress = leg.tracked && leg.current !== null && leg.market === 'player_prop';
  const a11y = `${pick}. ${leg.status === 'open' ? 'In progress' : leg.status}${progress ? `, ${formatStat(leg.current!)} of ${leg.target !== null ? formatStat(leg.target) : '?'}` : ''}.`;
  return (
    <View style={[styles.leg, dim && styles.dim]} accessible accessibilityLabel={a11y}>
      <View style={styles.legTop}>
        <Text style={styles.icon} maxFontSizeMultiplier={1.2}>
          {icon}
        </Text>
        <View style={styles.flex}>
          <Text style={styles.legPick}>{pick}</Text>
          <GameLine leg={leg} />
        </View>
        {progress && (
          <Text style={styles.value} maxFontSizeMultiplier={1.3}>
            {formatStat(leg.current!)}
            {leg.target !== null && <Text style={styles.muted}> / {formatStat(leg.target)}</Text>}
          </Text>
        )}
      </View>
      {pct !== null && leg.market === 'player_prop' && leg.status === 'open' && (
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${pct * 100}%`, backgroundColor: barColor }]} />
        </View>
      )}
    </View>
  );
}

function GameLine({ leg }: { leg: BetLeg }) {
  const g = leg.game;
  let text: string;
  if (!g || !g.home_team || !g.away_team) text = leg.team_abbr ?? 'Game not found this week';
  else {
    const score = g.state === 'pre' ? '' : ` ${g.away_score ?? 0}–${g.home_score ?? 0}`;
    const status = g.state === 'post' ? ' · Final' : g.state === 'in' ? ' · Live' : '';
    text = `${g.away_team} @ ${g.home_team}${score}${status}`;
  }
  if (!leg.tracked) text += ' · not auto-tracked';
  if (!leg.espn_event_id) return <Text style={styles.muted}>{text}</Text>;
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/gamecast/[id]', params: { id: leg.espn_event_id! } })}
      hitSlop={4}
      accessibilityRole="link">
      <Text style={[styles.muted, styles.link]}>{text}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  dim: { opacity: 0.45 },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  kicker: { color: Colors.textSecondary, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  muted: { color: Colors.textSecondary, fontSize: 12 },
  odds: { color: Colors.text, fontFamily: Fonts.monoBold, fontSize: 14 },
  pill: { borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  pillText: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 },
  leg: { gap: 6 },
  legTop: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  icon: { fontSize: 14, lineHeight: 20 },
  legPick: { color: Colors.text, fontSize: 14, fontWeight: '600', lineHeight: 20 },
  link: { textDecorationLine: 'underline' },
  value: { color: Colors.text, fontFamily: Fonts.monoBold, fontSize: 14 },
  track: { marginLeft: 24, height: 6, borderRadius: 3, backgroundColor: Colors.tileRaised, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3 },
  money: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
    paddingTop: Spacing.sm,
  },
  moneyStrong: { color: Colors.text, fontFamily: Fonts.monoBold },
});
