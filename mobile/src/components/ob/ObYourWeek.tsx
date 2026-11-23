import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeOut, interpolateColor, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { openTeam } from '@/components/league/LeagueUI';
import { Eyebrow, lampAt, OB, ObPane, ObWinBar } from '@/components/ob/Ob';
import { Text } from '@/components/Text';
import { Fonts } from '@/constants/theme';
import { haptics } from '@/lib/haptics';
import { isStarter } from '@/lib/livingHome';
import { useOwnerPhotos } from '@/lib/queries';
import type { MatchupContextSide, YourWeek } from '@/lib/types';

// The Your Week card in the Owners Box look (approved 2026-11-17, review
// round 2 "Home"): the team names on their own line so the scores get the
// full width, one plain result chip instead of a second headline, and the
// same frame live and final. Live: projections, win chance and your
// touchdowns. Final: the points split and how it was won (MVP, points
// left on the bench, how far off the projection). `me` is your side of
// the matchup, for those facts; without it the card just leaves them out.
export function ObYourWeek(props: {
  myWeek: YourWeek;
  isGameDay: boolean;
  leagueName: string | null;
  final?: boolean;
  me?: MatchupContextSide | null;
  them?: MatchupContextSide | null;
  // Settings > Your Week card: the card's light (Multi: its first color).
  color?: string;
}) {
  const { myWeek, me, them } = props;
  // Each side's profile picture, else initials.
  const photos = useOwnerPhotos();
  const m = myWeek.matchup!;
  const live = m.started && props.isGameDay && !props.final;
  const mine = m.my_score ?? 0;
  const theirs = m.opponent_score ?? 0;
  const result = !props.final ? null : mine === theirs ? 'T' : mine > theirs ? 'W' : 'L';
  const open = () => router.push({ pathname: '/matchup/[id]', params: { id: String(m.matchup_id) } });
  const label = `${myWeek.team_name} ${mine.toFixed(1)}, ${m.opponent_team_name} ${theirs.toFixed(1)}.${m.win_probability !== null && !result ? ` ${Math.round(m.win_probability)}% chance to win.` : ''}`;

  const kicker = live ? `Live · ${m.my_yet_to_play + m.my_in_play} of yours to play` : result ? `Week ${myWeek.week ?? ''} · Final` : `${m.is_playoff ? 'Playoffs · ' : ''}Week ${myWeek.week ?? ''}`;
  const facts = result && me ? finalFacts(me) : null;
  const tds = !result && me ? me.touchdowns.filter((t) => t.touchdowns > 0) : [];

  return (
    <ObPane lit light={props.color} contentStyle={styles.body}>
      <View style={styles.top}>
        <Eyebrow live={live} color={live ? OB.mute : OB.lamp}>
          {kicker}
        </Eyebrow>
        {result ? (
          <View style={[styles.chip, result !== 'W' && styles.chipQuiet]}>
            <Text style={[styles.chipText, result !== 'W' && { color: OB.ink2 }]}>{result === 'T' ? 'Tie' : `${result} · by ${Math.abs(mine - theirs).toFixed(1)}`}</Text>
          </View>
        ) : (
          <Text style={styles.league} numberOfLines={1}>
            {props.leagueName ?? ''}
          </Text>
        )}
      </View>

      <Pressable
        onPress={() => {
          haptics.tap();
          open();
        }}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint="Opens the matchup"
        style={({ pressed }) => [styles.tap, pressed && styles.pressed]}>
        <View style={styles.teams}>
          <Team
            photo={me ? photos.get(me.owner_id) : undefined}
            initials={initialsOf(m.my_owner_name ?? myWeek.team_name)}
            name={myWeek.team_name}
            meta={live ? `${m.my_yet_to_play} left · ${m.my_in_play} playing` : [m.record, myWeek.power_rank ? `#${myWeek.power_rank}` : null, m.my_result_streak].filter(Boolean).join(' · ')}
            mine
          />
          <Team
            photo={them ? photos.get(them.owner_id) : undefined}
            initials={initialsOf(m.opponent_owner_name ?? m.opponent_team_name)}
            name={m.opponent_team_name}
            meta={live ? `${m.opponent_yet_to_play} left · ${m.opponent_in_play} playing` : [m.opponent_record, m.opponent_power_rank ? `#${m.opponent_power_rank}` : null, m.opponent_result_streak].filter(Boolean).join(' · ')}
            right
          />
        </View>
        <View style={styles.scores}>
          <Score value={m.my_score} lit={result !== 'L'} />
          <Score value={m.opponent_score} dim right />
        </View>

        {result ? (
          <View style={styles.split} accessibilityElementsHidden>
            <View style={[styles.splitMine, { flex: Math.max(mine, 1) }]} />
            <View style={[styles.splitThem, { flex: Math.max(theirs, 1) }]} />
          </View>
        ) : (
          <>
            <View style={styles.proj}>
              <Text style={styles.projText}>
                proj <Text style={styles.projNum}>{m.my_projected_total.toFixed(1)}</Text>
              </Text>
              <Text style={styles.projText}>
                proj <Text style={styles.projNum}>{m.opponent_projected_total.toFixed(1)}</Text>
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
          </>
        )}
      </Pressable>

      {facts && (
        <View style={styles.facts}>
          {facts.map((f) => (
            <View key={f.label} style={styles.fact}>
              <Text style={styles.factLabel}>{f.label}</Text>
              <Text style={[styles.factValue, f.lit && { color: OB.lamp }]} numberOfLines={1} adjustsFontSizeToFit>
                {f.value}
              </Text>
              <Text style={styles.factSub} numberOfLines={2}>
                {f.sub}
              </Text>
            </View>
          ))}
        </View>
      )}

      {tds.length > 0 && (
        <View style={styles.tds}>
          <View style={styles.tdDot} />
          <Text style={styles.tdText}>
            <Text style={styles.tdLabel}>Touchdowns · </Text>
            {tds.map((t) => `${shortName(t.player_name)}${t.touchdowns > 1 ? ` ×${t.touchdowns}` : ''}`).join(', ')}
          </Text>
        </View>
      )}

      <View style={styles.cta}>
        <Pressable
          onPress={() => {
            haptics.tap();
            open();
          }}
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}
          accessibilityRole="button">
          <Text style={styles.buttonText}>Full matchup</Text>
        </Pressable>
        <Link text="Their roster" onPress={() => openTeam(m.opponent_team_id, myWeek.week)} />
        <Link text="Lineup" onPress={() => router.navigate('/team')} />
      </View>
    </ObPane>
  );
}

// How the week was won: your top starter, points left on your bench, and
// how far you finished from your pregame projection.
function finalFacts(me: MatchupContextSide): { label: string; value: string; sub: string; lit?: boolean }[] {
  const starters = me.roster.filter((p) => isStarter(p.lineup_slot));
  const bench = me.roster.filter((p) => p.lineup_slot === 'BE');
  const mvp = starters.reduce<(typeof starters)[number] | null>((best, p) => ((p.points_scored ?? 0) > (best?.points_scored ?? -Infinity) ? p : best), null);
  const benchPts = bench.reduce((sum, p) => sum + (p.points_scored ?? 0), 0);
  const facts: { label: string; value: string; sub: string; lit?: boolean }[] = [];
  if (mvp && mvp.points_scored !== null) facts.push({ label: 'MVP', value: shortName(mvp.player_name), sub: `${mvp.points_scored.toFixed(1)} pts` });
  facts.push({ label: 'Bench left', value: benchPts.toFixed(1), sub: 'pts' });
  if (me.pregame_projected_total !== null && me.score !== null) {
    const d = me.score - me.pregame_projected_total;
    facts.push({ label: 'Vs proj', value: `${d >= 0 ? '+' : ''}${d.toFixed(1)}`, sub: d >= 0 ? 'over' : 'under', lit: d >= 0 });
  }
  return facts;
}

function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(' ') : name;
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
}

function Team({ photo, initials, name, meta, mine, right }: { photo?: string; initials: string; name: string; meta: string; mine?: boolean; right?: boolean }) {
  return (
    <View style={[styles.team, right && styles.teamRight]}>
      <View style={[styles.avatar, mine && styles.avatarMine]}>
        {photo ? (
          <Image source={{ uri: photo }} style={styles.avatarPhoto} contentFit="cover" accessible={false} />
        ) : (
          <Text style={[styles.avatarText, mine && { color: OB.void }]}>{initials}</Text>
        )}
      </View>
      <View style={[styles.teamText, right && styles.alignRight]}>
        <Text style={styles.teamName} numberOfLines={2}>
          {name}
        </Text>
        {meta ? (
          <Text style={styles.meta} numberOfLines={2}>
            {meta}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

// A score that flashes when it goes up, with the gain floating off it.
function Score({ value, lit, dim, right }: { value: number | null; lit?: boolean; dim?: boolean; right?: boolean }) {
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
  const base = dim ? OB.mute : OB.ink;
  const style = useAnimatedStyle(() => ({ color: interpolateColor(flash.value, [0, 1], [base, OB.lampHi]) }));
  return (
    <View style={[styles.scoreWrap, right && styles.alignRight]}>
      {/* Big Shoulders' tall numerals clip if the line is shorter than the
          font (the tops were cut off, 2026-11-17). */}
      <Animated.Text style={[styles.score, lit && !dim && styles.scoreLit, style]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
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

function Link({ text, onPress }: { text: string; onPress: () => void }) {
  return (
    <Pressable
      hitSlop={8}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      accessibilityRole="link">
      <Text style={styles.link}>{text}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: { padding: 18, gap: 14 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  league: { color: OB.ink2, fontSize: 12.5, fontFamily: Fonts.bodyMedium, flexShrink: 1 },
  chip: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, borderWidth: 1, borderColor: lampAt(0.35), backgroundColor: lampAt(0.07) },
  chipQuiet: { borderColor: OB.rim2, backgroundColor: 'transparent' },
  chipText: { color: OB.lamp, fontFamily: Fonts.mono, fontSize: 11 },
  tap: { gap: 12 },
  pressed: { opacity: 0.85 },
  teams: { flexDirection: 'row', gap: 12 },
  team: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 9 },
  teamRight: { flexDirection: 'row-reverse' },
  teamText: { flex: 1, minWidth: 0 },
  alignRight: { alignItems: 'flex-end' },
  teamName: { color: OB.ink, fontFamily: Fonts.bodySemiBold, fontSize: 13 },
  meta: { color: OB.mute, fontFamily: Fonts.mono, fontSize: 10.5, marginTop: 2 },
  avatar: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1d2128', borderWidth: 1, borderColor: OB.rim2, overflow: 'hidden' },
  avatarPhoto: { width: '100%', height: '100%' },
  avatarMine: { backgroundColor: OB.ink, borderWidth: 1.5, borderColor: lampAt(0.6) },
  avatarText: { color: OB.ink, fontFamily: Fonts.bodyBold, fontSize: 11.5 },
  scores: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12 },
  scoreWrap: { flex: 1, minWidth: 0 },
  score: { fontFamily: OB.displayBlack, fontSize: 76, lineHeight: 86, letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
  scoreLit: { textShadowColor: lampAt(0.35), textShadowRadius: 24 },
  gain: { position: 'absolute', top: 0, fontFamily: OB.display, fontSize: 18, lineHeight: 22, color: OB.lamp },
  gainLeft: { right: 4 },
  gainRight: { left: 4 },
  split: { flexDirection: 'row', gap: 3, height: 6 },
  splitMine: { borderRadius: 3, backgroundColor: OB.lamp, shadowColor: OB.lamp, shadowOpacity: 0.6, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } },
  splitThem: { borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.14)' },
  proj: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  projText: { color: OB.mute, fontFamily: Fonts.mono, fontSize: 11 },
  projNum: { color: OB.ink },
  win: { gap: 8 },
  winLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  winText: { fontFamily: Fonts.mono, fontSize: 11, color: OB.mute },
  facts: { flexDirection: 'row', gap: 8 },
  fact: { flex: 1, minWidth: 0, padding: 10, borderRadius: 14, borderWidth: 1, borderColor: OB.rim, backgroundColor: 'rgba(255,255,255,0.035)', gap: 2 },
  factLabel: { color: OB.mute, fontFamily: Fonts.mono, fontSize: 9.5, letterSpacing: 1.2, textTransform: 'uppercase' },
  factValue: { color: OB.ink, fontFamily: OB.display, fontSize: 22, lineHeight: 28 },
  factSub: { color: OB.mute, fontFamily: Fonts.mono, fontSize: 10 },
  tds: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 14, borderWidth: 1, borderColor: lampAt(0.2), backgroundColor: lampAt(0.06) },
  tdDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: OB.lamp, shadowColor: OB.lamp, shadowOpacity: 0.9, shadowRadius: 5, shadowOffset: { width: 0, height: 0 } },
  tdText: { flex: 1, color: OB.ink, fontSize: 13, fontFamily: Fonts.bodyMedium },
  tdLabel: { color: OB.mute },
  cta: { flexDirection: 'row', alignItems: 'center', gap: 16, flexWrap: 'wrap' },
  button: { height: 36, paddingHorizontal: 16, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: OB.ink },
  buttonText: { color: OB.void, fontFamily: Fonts.bodySemiBold, fontSize: 13 },
  link: { color: OB.ink2, fontSize: 13, fontFamily: Fonts.bodyMedium },
});
