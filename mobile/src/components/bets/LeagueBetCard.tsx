import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { BetCard } from '@/components/bets/BetCard';
import { Display, Text } from '@/components/Text';
import { Colors, Fonts, Radius, Spacing, withAlpha } from '@/constants/theme';
import { api } from '@/lib/api';
import { useAppearance } from '@/lib/appearance';
import { formatStat } from '@/lib/bets';
import { haptics } from '@/lib/haptics';
import { queryClient } from '@/lib/queries';
import type { BetMember, BetReaction, LeagueBet } from '@/lib/types';

// League Bets' pieces (2026-10-17 mockups, "League Bets Mockups"
// canvas): a bettor's avatar, units, and one league bet with who placed
// it and Tail / Fade / Sweat. The slip itself is BetCard, so legs look
// the same as on My Bets.

export const AMBER = '#f59e0b';
export const WIN = '#22c55e';
export const LOSS = '#f87171';
const PALETTE = ['#6366f1', '#ec4899', '#0ea5e9', '#f97316', '#14b8a6', '#a855f7', '#84cc16', '#eab308', '#ef4444', '#22d3ee'];

export function memberColor(m: BetMember): string {
  return m.color && /^#[0-9a-f]{6}$/i.test(m.color) ? m.color : PALETTE[m.user_id % PALETTE.length];
}

export function BetAvatar({ member, size = 38, ring }: { member: BetMember; size?: number; ring?: string }) {
  const initials = member.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
  const color = memberColor(member);
  return (
    <View
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: color },
        ring ? { borderWidth: 2, borderColor: ring } : null,
      ]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      <Text style={[styles.avatarText, { fontSize: size * 0.36 }]} maxFontSizeMultiplier={1}>
        {initials}
      </Text>
    </View>
  );
}

export function AvatarStack({ members, size = 26, extra = 0 }: { members: BetMember[]; size?: number; extra?: number }) {
  return (
    <View style={styles.stack} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {members.map((m, i) => (
        <View key={m.user_id} style={[styles.stackItem, i > 0 && { marginLeft: -size * 0.32 }]}>
          <BetAvatar member={m} size={size} />
        </View>
      ))}
      {extra > 0 && (
        <View style={[styles.stackItem, styles.extra, { width: size, height: size, borderRadius: size / 2, marginLeft: -size * 0.32 }]}>
          <Text style={styles.extraText}>+{extra}</Text>
        </View>
      )}
    </View>
  );
}

export function formatUnits(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined) return '—';
  const v = Math.abs(n).toFixed(digits);
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${v}u`;
}

export function unitsColor(n: number | null | undefined, accent: string): string {
  return !n ? Colors.textSecondary : n > 0 ? accent : LOSS;
}

function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function Icon({ kind, color }: { kind: 'tail' | 'fade' | 'flame' | 'rip'; color: string }) {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      {kind === 'tail' && <Path d="M7 17L17 7M9 7h8v8" />}
      {kind === 'fade' && <Path d="M17 7L7 17M15 17H7V9" />}
      {kind === 'flame' && <Path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-4 2.5-5 .3 2 1.5 3 2.5 3 0-3-1-5.5 0-8z" />}
      {kind === 'rip' && (
        <>
          <Path d="M7 21V10a5 5 0 0 1 10 0v11z" />
          <Circle cx={12} cy={12} r={0.5} />
          <Path d="M10 13h4M12 11v5" />
        </>
      )}
    </Svg>
  );
}

// Who placed it, above the slip; tapping them opens their betting card.
function BettorRow({ bet }: { bet: LeagueBet }) {
  const m = bet.member;
  const away = bet.one_leg_away;
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/bets/league/member/[id]', params: { id: String(m.user_id) } })}
      accessibilityRole="button"
      accessibilityLabel={`${m.name}'s betting card`}
      style={({ pressed }) => [styles.bettor, pressed && styles.pressed]}>
      <BetAvatar member={m} ring={away ? AMBER : undefined} />
      <View style={styles.flex}>
        <Text style={styles.name} numberOfLines={1}>
          {m.name}
          {m.team_name ? <Text style={styles.soft}> · {m.team_name}</Text> : null}
        </Text>
        <Text style={styles.soft} numberOfLines={1}>
          {[bet.sportsbook, timeAgo(bet.created_at), `${bet.member_record} this season`].filter(Boolean).join(' · ')}
        </Text>
      </View>
      {away && (
        <View style={[styles.flag, { backgroundColor: withAlpha(AMBER, 0.15) }]}>
          <Text style={[styles.flagText, { color: AMBER }]}>1 leg away</Text>
        </View>
      )}
    </Pressable>
  );
}

export function LeagueBetCard({ bet }: { bet: LeagueBet }) {
  const accent = useAppearance().accent;
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const settled = bet.status !== 'open';
  const busted = bet.status === 'lost';

  async function act(action: () => Promise<unknown>, done?: string) {
    if (busy) return;
    setBusy(true);
    setNote(null);
    haptics.tap();
    try {
      await action();
      if (done) setNote(done);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['league-bets'] }),
        queryClient.invalidateQueries({ queryKey: ['league-bet-member'] }),
      ]);
    } catch (e) {
      haptics.error();
      setNote(e instanceof Error ? e.message : 'Something went wrong — try again.');
    } finally {
      setBusy(false);
    }
  }

  function tail() {
    if (bet.tails.mine) {
      router.push('/bets');
      return;
    }
    Alert.alert(
      `Tail ${bet.member.name}?`,
      'Saves the same picks to My Bets so they track for you too. Add your wager there if you want.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Tail it',
          onPress: () =>
            void act(async () => {
              await api.tailBet(bet.id);
              haptics.success();
              await queryClient.invalidateQueries({ queryKey: ['bets'] });
            }, 'Tailed. It’s in My Bets.'),
        },
      ],
    );
  }

  const react = (kind: BetReaction) => act(() => api.reactToBet(bet.id, kind, !bet.reactions[kind].mine));
  const beat = bet.bad_beat;
  const beatLeg = beat ? bet.legs.find((l) => l.id === beat.leg_id) : null;
  const glow =
    bet.one_leg_away ? styles.glowAmber : bet.status === 'won' ? styles.glowWin : null;

  const footer = (
    <View style={styles.footer}>
      {beat && (
        <View style={styles.beat}>
          <Display style={styles.beatStamp}>Bad beat</Display>
          <Text style={styles.beatText}>
            {beat.missed_by !== null && beatLeg
              ? `Missed ${beatLeg.player_name ?? 'it'} by ${formatStat(beat.missed_by)}. Every other leg hit.`
              : 'Lost on the last leg. Every other leg hit.'}
          </Text>
        </View>
      )}
      {bet.tails.count > 0 && (
        <Text style={styles.soft}>
          Tailed by <Text style={styles.strong}>{bet.tails.names.join(', ')}</Text>
          {bet.tails.count > bet.tails.names.length ? ` +${bet.tails.count - bet.tails.names.length}` : ''}
          {bet.status === 'won' ? ' — they hit too' : ''}
        </Text>
      )}
      <View style={styles.actions}>
        {!bet.mine && !settled && (
          <ActionButton
            label={bet.tails.mine ? 'Tailed' : 'Tail'}
            count={bet.tails.count}
            icon="tail"
            color={accent}
            active={bet.tails.mine}
            primary
            disabled={busy}
            onPress={tail}
            hint={bet.tails.mine ? 'Opens My Bets' : 'Saves these picks to My Bets'}
          />
        )}
        {!bet.mine && !settled && !bet.tails.mine && (
          <ActionButton
            label="Fade"
            count={bet.reactions.fade.count}
            icon="fade"
            color={Colors.text}
            active={bet.reactions.fade.mine}
            disabled={busy}
            onPress={() => void react('fade')}
            hint="You're betting against it"
          />
        )}
        {!settled && (
          <ActionButton
            label="Sweat"
            count={bet.reactions.sweat.count}
            icon="flame"
            color="#f97316"
            active={bet.reactions.sweat.mine}
            disabled={busy}
            onPress={() => void react('sweat')}
            hint="You're watching it with them"
          />
        )}
        {busted && (
          <ActionButton
            label="RIP"
            count={bet.reactions.rip.count}
            icon="rip"
            color={LOSS}
            active={bet.reactions.rip.mine}
            disabled={busy}
            onPress={() => void react('rip')}
            hint="Pay your respects"
          />
        )}
        {bet.status === 'won' && bet.units !== null && (
          <View style={styles.units}>
            <Text style={[styles.unitsText, { color: accent }]}>{formatUnits(bet.units)}</Text>
          </View>
        )}
      </View>
      {note && <Text style={styles.soft}>{note}</Text>}
    </View>
  );

  return (
    <View style={[styles.wrap, glow]}>
      {/* Not `shared`: the bettor's row already names them, and a league
          bet never carries the money. */}
      <BetCard bet={bet} header={<BettorRow bet={bet} />} footer={footer} />
    </View>
  );
}

function ActionButton({
  label,
  count,
  icon,
  color,
  active,
  primary,
  disabled,
  onPress,
  hint,
}: {
  label: string;
  count: number;
  icon: 'tail' | 'fade' | 'flame' | 'rip';
  color: string;
  active: boolean;
  primary?: boolean;
  disabled: boolean;
  onPress: () => void;
  hint: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`${label}${count ? `, ${count}` : ''}`}
      accessibilityHint={hint}
      accessibilityState={{ selected: active, disabled }}
      style={({ pressed }) => [
        styles.action,
        primary && { backgroundColor: withAlpha(color, 0.12) },
        active && { borderColor: withAlpha(color, 0.6), backgroundColor: withAlpha(color, 0.16) },
        pressed && styles.pressed,
      ]}>
      <Icon kind={icon} color={color} />
      <Text style={[styles.actionText, primary && { color }]}>
        {label}
        {count > 0 ? ` · ${count}` : ''}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.7 },
  avatar: { alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontWeight: '700' },
  stack: { flexDirection: 'row', alignItems: 'center' },
  stackItem: { borderRadius: 99, borderWidth: 2, borderColor: Colors.surface },
  extra: { backgroundColor: Colors.tileRaised, alignItems: 'center', justifyContent: 'center' },
  extraText: { color: Colors.textSecondary, fontSize: 10, fontWeight: '700' },
  wrap: { borderRadius: Radius.lg },
  glowAmber: { shadowColor: AMBER, shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 0 } },
  glowWin: { shadowColor: WIN, shadowOpacity: 0.3, shadowRadius: 14, shadowOffset: { width: 0, height: 0 } },
  bettor: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  name: { color: Colors.text, fontSize: 14, fontWeight: '600' },
  soft: { color: Colors.textSecondary, fontSize: 12 },
  strong: { color: Colors.text, fontWeight: '600' },
  flag: { borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  flagText: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 },
  footer: { gap: Spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border, paddingTop: Spacing.md },
  beat: { gap: 4, borderRadius: Radius.md, padding: Spacing.md, backgroundColor: withAlpha('#ef4444', 0.08) },
  beatStamp: { color: LOSS, fontSize: 18 },
  beatText: { color: LOSS, fontSize: 12, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: Spacing.sm, flexWrap: 'wrap' },
  action: {
    flexGrow: 1,
    flexBasis: 0,
    minHeight: 44,
    borderRadius: Radius.md,
    backgroundColor: Colors.tile,
    borderWidth: 1,
    borderColor: 'transparent',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: Spacing.sm,
  },
  actionText: { color: Colors.text, fontSize: 13, fontWeight: '600' },
  units: { minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.sm },
  unitsText: { fontFamily: Fonts.monoBold, fontSize: 14 },
});
