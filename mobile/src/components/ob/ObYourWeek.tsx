import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming, FadeInDown, FadeOut } from 'react-native-reanimated';

import { openTeam } from '@/components/league/LeagueUI';
import { Eyebrow, OB, ObPane, ObWinBar, OpenBox } from '@/components/ob/Ob';
import { Text } from '@/components/Text';
import { Fonts } from '@/constants/theme';
import { haptics } from '@/lib/haptics';
import type { YourWeek } from '@/lib/types';

// The Your Week card in the Owners Box look: the scoreboard. Everything
// the classic card shows (components/home/YourWeekCard.tsx) — league and
// week, live or final, both scores with projections, win chance, each
// side's rank, owner, record and streak, starters left and playing — as
// the one lit panel on Home. A score that goes up flashes, with the
// points it just gained floating off it.
export function ObYourWeek(props: { myWeek: YourWeek; isGameDay: boolean; leagueName: string | null; final?: boolean }) {
  const { myWeek } = props;
  const m = myWeek.matchup!;
  const live = m.started && props.isGameDay && !props.final;
  const winning = m.my_score !== null && m.opponent_score !== null && m.my_score >= m.opponent_score;
  const tie = props.final && m.my_score === m.opponent_score;
  const result = !props.final ? null : tie ? 'tie' : winning ? 'win' : 'loss';
  const margin = Math.abs((m.my_score ?? 0) - (m.opponent_score ?? 0));
  const them = m.opponent_owner_name ?? m.opponent_team_name;
  const open = () => router.push({ pathname: '/matchup/[id]', params: { id: String(m.matchup_id) } });
  const pts = (n: number | null) => `${(n ?? 0).toFixed(1)} points`;
  const label = `${myWeek.team_name} ${pts(m.my_score)}, projected ${m.my_projected_total.toFixed(1)}. ${m.opponent_team_name} ${pts(m.opponent_score)}, projected ${m.opponent_projected_total.toFixed(1)}.${m.win_probability !== null ? ` ${Math.round(m.win_probability)}% chance to win.` : ''}`;

  const kicker = live
    ? `Live · ${m.my_yet_to_play + m.my_in_play} of yours to play`
    : result
      ? `Week ${myWeek.week ?? ''} · Final`
      : `${m.is_playoff ? 'Playoffs · ' : ''}Week ${myWeek.week ?? ''}`;

  return (
    <ObPane lit contentStyle={styles.body}>
      <View style={styles.top}>
        <Eyebrow live={live} color={live ? OB.mute : OB.lamp}>
          {kicker}
        </Eyebrow>
        <Text style={styles.league} numberOfLines={1}>
          {props.leagueName ?? 'Your week'}
        </Text>
      </View>

      {result && (
        <Text style={[styles.result, result === 'loss' && styles.resultLoss]}>
          {result === 'win' ? `You beat ${them} by ${margin.toFixed(1)}` : result === 'loss' ? `${them} beat you by ${margin.toFixed(1)}` : 'A dead-even tie'}
        </Text>
      )}

      <Pressable
        onPress={() => {
          haptics.tap();
          open();
        }}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint="Opens the matchup"
        style={({ pressed }) => pressed && styles.pressed}>
        <View style={styles.vs}>
          <Side name={myWeek.team_name} owner={m.my_owner_name} rank={myWeek.power_rank} record={m.record} streak={m.my_result_streak} score={m.my_score} mine dim={result === 'loss'} />
          <Text style={styles.vsText}>VS</Text>
          <Side
            name={m.opponent_team_name}
            owner={m.opponent_owner_name}
            rank={m.opponent_power_rank}
            record={m.opponent_record}
            streak={m.opponent_result_streak}
            score={m.opponent_score}
            dim={result !== 'loss'}
            right
          />
        </View>
        <View style={styles.proj}>
          <Text style={styles.projText}>
            proj <Text style={styles.projNum}>{m.my_projected_total.toFixed(1)}</Text> · {m.my_yet_to_play} left · {m.my_in_play} playing
          </Text>
          <Text style={styles.projText}>
            proj <Text style={styles.projNum}>{m.opponent_projected_total.toFixed(1)}</Text> · {m.opponent_yet_to_play} left
          </Text>
        </View>
        {m.win_probability !== null && (
          <View style={styles.win}>
            <ObWinBar percent={m.win_probability} />
            <View style={styles.winLabels}>
              <Text style={[styles.winText, { color: OB.lamp }]}>{Math.round(m.win_probability)}% to win</Text>
              <Text style={styles.winText}>{Math.round(100 - m.win_probability)}%</Text>
            </View>
          </View>
        )}
      </Pressable>

      <View style={styles.links}>
        <Link text="Full matchup" onPress={open} strong />
        <Link text="Their roster" onPress={() => openTeam(m.opponent_team_id, myWeek.week)} />
        <Link text="My lineup" onPress={() => router.navigate('/team')} />
      </View>
    </ObPane>
  );
}

function Side(props: { name: string; owner: string | null; rank: number | null; record: string | null; streak: string | null; score: number | null; mine?: boolean; dim?: boolean; right?: boolean }) {
  return (
    <View style={[styles.side, props.right && styles.sideRight]}>
      <View style={[styles.who, props.right && styles.whoRight]}>
        {props.rank !== null ? <OpenBox n={props.rank} mine={props.mine} size={26} /> : null}
        <View style={[styles.whoText, props.right && styles.alignRight]}>
          <Text style={styles.team} numberOfLines={1}>
            {props.name}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {[props.owner, props.record, props.streak].filter(Boolean).join(' · ')}
          </Text>
        </View>
      </View>
      <Score value={props.score} mine={props.mine} dim={props.dim} right={props.right} />
    </View>
  );
}

// A score that flashes when it goes up, with the gain floating off it.
function Score({ value, mine, dim, right }: { value: number | null; mine?: boolean; dim?: boolean; right?: boolean }) {
  const reduce = useReducedMotion();
  const flash = useSharedValue(0);
  const last = useRef(value);
  const [gain, setGain] = useState<{ n: number; key: number } | null>(null);
  useEffect(() => {
    const before = last.current;
    last.current = value;
    if (before === null || value === null || value <= before) return;
    const n = Math.round((value - before) * 10) / 10;
    if (n < 0.1) return;
    setGain({ n, key: Date.now() });
    if (!reduce) {
      flash.value = 1;
      flash.value = withTiming(0, { duration: 1400 });
    }
    const t = setTimeout(() => setGain(null), 2200);
    return () => clearTimeout(t);
  }, [value, reduce, flash]);
  const base = dim ? 'rgba(200,204,210,0.7)' : OB.ink;
  const style = useAnimatedStyle(() => ({ color: interpolateColor(flash.value, [0, 1], [base, OB.lampHi]) }));
  return (
    <View style={[styles.scoreWrap, right && styles.alignRight]}>
      <Animated.Text style={[styles.score, mine && !dim && styles.scoreMine, style]} numberOfLines={1} adjustsFontSizeToFit>
        {value === null ? '—' : value.toFixed(1)}
      </Animated.Text>
      {gain && (
        <Animated.Text key={gain.key} entering={FadeInDown.duration(300)} exiting={FadeOut.duration(500)} style={[styles.gain, right ? styles.gainRight : styles.gainLeft]}>
          +{gain.n.toFixed(1)}
        </Animated.Text>
      )}
    </View>
  );
}

function Link({ text, onPress, strong }: { text: string; onPress: () => void; strong?: boolean }) {
  return (
    <Pressable
      hitSlop={8}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      accessibilityRole="link">
      <Text style={[styles.link, strong && styles.linkStrong]}>{text} ›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: { padding: 18, gap: 14 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  league: { color: OB.ink2, fontSize: 12.5, fontFamily: Fonts.bodyMedium, flexShrink: 1 },
  result: { fontFamily: OB.displayBlack, fontSize: 26, lineHeight: 32, color: OB.lamp, textTransform: 'uppercase' },
  resultLoss: { color: OB.ink2 },
  pressed: { opacity: 0.85 },
  vs: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  vsText: { fontFamily: Fonts.mono, fontSize: 10, letterSpacing: 2, color: OB.dim, paddingBottom: 12 },
  side: { flex: 1, minWidth: 0, gap: 10 },
  sideRight: { alignItems: 'flex-end' },
  who: { flexDirection: 'row', alignItems: 'center', gap: 9, minWidth: 0 },
  whoRight: { flexDirection: 'row-reverse' },
  whoText: { minWidth: 0, flexShrink: 1 },
  alignRight: { alignItems: 'flex-end' },
  team: { color: OB.ink, fontFamily: Fonts.bodySemiBold, fontSize: 13 },
  meta: { color: OB.mute, fontFamily: Fonts.mono, fontSize: 10.5, marginTop: 2 },
  scoreWrap: { minWidth: 0 },
  // Big Shoulders' tall numerals clip if the line is shorter than the font
  // (the tops of the scores were cut off, 2026-11-17).
  score: { fontFamily: OB.displayBlack, fontSize: 70, lineHeight: 80, letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
  scoreMine: { textShadowColor: 'rgba(57,255,20,0.4)', textShadowRadius: 22 },
  gain: { position: 'absolute', top: -6, fontFamily: OB.display, fontSize: 18, color: OB.lamp },
  gainLeft: { right: 0 },
  gainRight: { left: 0 },
  proj: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, marginTop: 10 },
  projText: { color: OB.mute, fontFamily: Fonts.mono, fontSize: 10.5, flexShrink: 1 },
  projNum: { color: OB.ink },
  win: { marginTop: 14, gap: 8 },
  winLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  winText: { fontFamily: Fonts.mono, fontSize: 11, color: OB.mute },
  links: { flexDirection: 'row', gap: 18, flexWrap: 'wrap', paddingTop: 2 },
  link: { color: OB.ink2, fontSize: 13, fontFamily: Fonts.bodyMedium },
  linkStrong: { color: OB.ink },
});

