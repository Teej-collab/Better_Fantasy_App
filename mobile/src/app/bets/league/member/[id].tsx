import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { AppRefreshControl } from '@/components/AppRefreshControl';
import { BetAvatar, formatUnits, LeagueBetCard, LOSS, memberColor, unitsColor, WIN } from '@/components/bets/LeagueBetCard';
import { Display, Text } from '@/components/Text';
import { LoadingState, MessageState } from '@/components/ui';
import { Colors, Fonts, Radius, Spacing, withAlpha } from '@/constants/theme';
import { api } from '@/lib/api';
import { useAppearance } from '@/lib/appearance';
import { formatOdds, legPick } from '@/lib/bets';
import { haptics } from '@/lib/haptics';
import { queryClient, useLeagueBetMember } from '@/lib/queries';
import type { LeagueMemberCard } from '@/lib/types';

// A league-mate's betting card (League Bets): their record and units,
// form, how they bet, their biggest hit, you vs them, and "Ping me when
// they bet". Shared bets only; never any wager.

const FORM_COLOR = { won: WIN, lost: '#3a1a1d', push: Colors.tileRaised, open: 'transparent' } as const;

function pct(n: number | null): string {
  return n === null ? '—' : `${Math.round(n * 100)}%`;
}

export default function LeagueMemberScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useLeagueBetMember(Number(id));
  if (q.isPending) return <LoadingState />;
  if (q.isError || !q.data) return <MessageState message={q.error instanceof Error ? q.error.message : "Couldn't load their betting card."} />;
  return <MemberCard card={q.data} />;
}

function MemberCard({ card }: { card: LeagueMemberCard }) {
  const accent = useAppearance().accent;
  const m = card.member;
  const rec = card.record;
  const style = card.style;
  const color = memberColor(m);
  const first = m.name.split(' ')[0];
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={<AppRefreshControl />}>
      <Stack.Screen options={{ title: card.me ? 'Your betting card' : `${first}'s bets`, headerBackTitle: 'Back' }} />

      <View style={styles.hero}>
        <View style={[styles.halo, { shadowColor: color }]}>
          <BetAvatar member={m} size={84} ring={card.rank === 1 ? '#facc15' : undefined} />
        </View>
        <Display style={styles.title}>{m.name}</Display>
        <Text style={styles.soft}>
          {[m.team_name, card.rank ? `#${card.rank} of ${card.of} on The Board` : null].filter(Boolean).join(' · ')}
        </Text>
      </View>

      <View style={styles.stats}>
        <Stat value={`${rec.wins}–${rec.losses}`} label="Record" />
        <Stat value={formatUnits(rec.units)} label="Units" color={unitsColor(rec.units, accent)} />
        <Stat
          value={rec.streak ?? '—'}
          label="Streak"
          color={rec.streak?.startsWith('W') ? '#f97316' : rec.streak?.startsWith('L') ? LOSS : undefined}
        />
      </View>

      {card.form.length > 0 && (
        <View style={styles.panel}>
          <View style={styles.rowBetween}>
            <Text style={styles.kicker}>Form · last {card.form.length}</Text>
            <Text style={styles.kicker}>Oldest → newest</Text>
          </View>
          <View style={styles.form} accessible accessibilityLabel={`Last ${card.form.length} bets: ${card.form.join(', ')}`}>
            {card.form.map((f, i) => (
              <View
                key={i}
                style={[styles.dot, { backgroundColor: FORM_COLOR[f] }, f === 'open' && { borderWidth: 2, borderColor: '#38bdf8' }]}
              />
            ))}
          </View>
        </View>
      )}

      {(style.favorite_player || style.go_to_stat || style.parlay_rate !== null) && (
        <View style={styles.panel}>
          <Text style={styles.kicker}>Betting style</Text>
          <View style={styles.styleGrid}>
            {style.favorite_player && (
              <StyleCell
                label="Favorite player"
                value={style.favorite_player.player_name}
                sub={`${style.favorite_player.wins}–${style.favorite_player.losses} on him`}
                subColor={style.favorite_player.wins > style.favorite_player.losses ? WIN : undefined}
              />
            )}
            {style.go_to_stat && <StyleCell label="Go-to market" value={style.go_to_stat.label} sub={`${pct(style.go_to_stat.share)} of legs`} />}
            {style.parlay_rate !== null && (
              <StyleCell
                label="Parlay rate"
                value={pct(style.parlay_rate)}
                sub={style.avg_parlay_legs ? `avg ${style.avg_parlay_legs} legs` : 'straight bets'}
              />
            )}
            {style.overs_share !== null && (
              <StyleCell
                label="Overs"
                value={pct(style.overs_share)}
                sub={style.overs_share >= 0.9 ? 'never met an under' : style.overs_share <= 0.4 ? 'unders guy' : 'mixes it up'}
              />
            )}
          </View>
        </View>
      )}

      {card.biggest_hit && (
        <View style={[styles.panel, styles.hit]}>
          <View style={styles.rowBetween}>
            <Text style={[styles.kicker, { color: '#facc15' }]}>Biggest hit</Text>
            <Text style={[styles.mono, { fontSize: 22, color: '#facc15' }]}>{formatOdds(card.biggest_hit.odds_american)}</Text>
          </View>
          <Text style={styles.name}>
            {card.biggest_hit.legs.map((l) => `${l.player_name ? `${l.player_name.split(' ').slice(-1)[0]} ` : ''}${legPick(l)}`).join(' · ')}
          </Text>
          <Text style={styles.soft}>
            {card.biggest_hit.tails > 0 ? `Tailed by ${card.biggest_hit.tails}. ` : ''}
            {new Date(card.biggest_hit.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </Text>
        </View>
      )}

      {card.vs && <VersusYou card={card} accent={accent} />}

      {!card.me && <FollowButton card={card} accent={accent} />}

      {card.bets.length > 0 && <Display style={styles.section}>Recent bets</Display>}
      {card.bets.map((b) => (
        <LeagueBetCard key={b.id} bet={b} />
      ))}
      {card.bets.length === 0 && <Text style={styles.softCenter}>{card.me ? 'You haven’t' : `${first} hasn’t`} shared a bet this season.</Text>}
    </ScrollView>
  );
}

function Stat({ value, label, color }: { value: string; label: string; color?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.mono, { fontSize: 20 }, color ? { color } : null]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={styles.soft}>{label}</Text>
    </View>
  );
}

function StyleCell({ label, value, sub, subColor }: { label: string; value: string; sub: string; subColor?: string }) {
  return (
    <View style={styles.styleCell}>
      <Text style={styles.soft}>{label}</Text>
      <Text style={styles.name} numberOfLines={1}>
        {value}
      </Text>
      <Text style={[styles.soft, subColor ? { color: subColor } : null]}>{sub}</Text>
    </View>
  );
}

function VersusYou({ card, accent }: { card: LeagueMemberCard; accent: string }) {
  const vs = card.vs!;
  const you = vs.you.units;
  const them = vs.them.units;
  // The bar splits on units above the lower of the two, so a negative
  // season still draws.
  const floor = Math.min(0, you, them);
  const a = you - floor + 0.5;
  const b = them - floor + 0.5;
  const first = card.member.name.split(' ')[0];
  return (
    <View style={styles.panel}>
      <Text style={styles.kicker}>You vs {first}</Text>
      <View style={styles.rowCenter}>
        <Text style={[styles.mono, { color: unitsColor(you, accent) }]}>{formatUnits(you)}</Text>
        <View style={styles.vsTrack}>
          <View style={{ flex: a, backgroundColor: accent }} />
          <View style={{ flex: b, backgroundColor: memberColor(card.member) }} />
        </View>
        <Text style={[styles.mono, { color: unitsColor(them, accent) }]}>{formatUnits(them)}</Text>
      </View>
      <Text style={styles.soft}>
        You&apos;re {vs.you.wins}–{vs.you.losses}, {first} is {vs.them.wins}–{vs.them.losses}.
        {vs.shared_players.length > 0 ? ` You've both bet on ${vs.shared_players.slice(0, 3).join(', ')}.` : ''}
      </Text>
    </View>
  );
}

function FollowButton({ card, accent }: { card: LeagueMemberCard; accent: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = card.member.name.split(' ')[0];
  const on = card.following;
  async function toggle() {
    setBusy(true);
    setError(null);
    haptics.tap();
    try {
      await api.followBettor(card.member.user_id, !on);
      haptics.success();
      await queryClient.invalidateQueries({ queryKey: ['league-bet-member', card.member.user_id] });
    } catch (e) {
      haptics.error();
      setError(e instanceof Error ? e.message : 'Something went wrong — try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={styles.followWrap}>
      <Pressable
        onPress={() => void toggle()}
        disabled={busy}
        accessibilityRole="button"
        accessibilityState={{ selected: on, disabled: busy }}
        style={({ pressed }) => [
          styles.follow,
          on ? { borderWidth: 1, borderColor: withAlpha(accent, 0.6) } : { backgroundColor: accent },
          (pressed || busy) && styles.pressed,
        ]}>
        <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={on ? accent : '#06110a'} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
          <Path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8" />
          <Path d="M10 20a2 2 0 0 0 4 0" />
        </Svg>
        <Text style={[styles.followText, { color: on ? accent : '#06110a' }]}>{on ? `Pinging you when ${first} bets` : `Ping me when ${first} bets`}</Text>
      </Pressable>
      <Text style={styles.softCenter}>{on ? 'Tap to stop.' : 'Get a push the moment they share a bet, so you can tail it.'}</Text>
      {error && <Text style={[styles.softCenter, { color: LOSS }]}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xl * 3, gap: Spacing.lg },
  pressed: { opacity: 0.7 },
  kicker: { color: Colors.textSecondary, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  soft: { color: Colors.textSecondary, fontSize: 12 },
  softCenter: { color: Colors.textSecondary, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  name: { color: Colors.text, fontSize: 14, fontWeight: '600' },
  mono: { color: Colors.text, fontFamily: Fonts.monoBold, fontSize: 13 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowCenter: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  hero: { alignItems: 'center', gap: Spacing.sm, paddingTop: Spacing.md },
  halo: { borderRadius: 50, shadowOpacity: 0.5, shadowRadius: 24, shadowOffset: { width: 0, height: 0 } },
  title: { color: Colors.text, fontSize: 30, lineHeight: 34, marginTop: 4 },
  stats: { flexDirection: 'row', gap: Spacing.sm },
  stat: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    padding: Spacing.md,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  panel: { gap: Spacing.md, padding: Spacing.lg, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface },
  form: { flexDirection: 'row', gap: 4, flexWrap: 'wrap' },
  dot: { width: 20, height: 20, borderRadius: 6 },
  styleGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: Spacing.md },
  styleCell: { width: '50%', gap: 2, paddingRight: Spacing.sm },
  hit: { borderColor: 'rgba(250,204,21,0.35)', backgroundColor: '#1d1a0e', gap: Spacing.sm },
  vsTrack: { flex: 1, flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', backgroundColor: Colors.tileRaised },
  followWrap: { gap: Spacing.sm },
  follow: { minHeight: 48, borderRadius: Radius.pill, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  followText: { fontSize: 14, fontWeight: '700' },
  section: { color: Colors.text, fontSize: 18 },
});
