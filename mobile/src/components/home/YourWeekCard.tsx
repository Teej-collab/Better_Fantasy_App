import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { NeonPanel } from '@/components/NeonPanel';
import { Display, Text } from '@/components/Text';
import { TeamAvatar } from '@/components/ui';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { seasonalEmblem } from '@/lib/seasonal';
import type { YourWeek } from '@/lib/types';

// Port of the web's YourWeekCard (frontend/src/components/
// YourWeekCard.tsx): league emblem and week, both scores with live
// projections, the win-probability bar, then each side's rank, owner,
// record with streak, and starters yet to play / in play.
export function YourWeekCard(props: { myWeek: YourWeek; isGameDay: boolean; leagueName: string | null; color: string }) {
  const { myWeek } = props;
  const m = myWeek.matchup!;
  const isLive = m.started && props.isGameDay;
  const winning = m.my_score !== null && m.opponent_score !== null && m.my_score >= m.opponent_score;
  // The scores are bare numbers on screen; say whose is whose.
  const pts = (n: number | null) => `${(n ?? 0).toFixed(1)} points`;
  const scoreLabel = `${myWeek.team_name} ${pts(m.my_score)}, projected ${m.my_projected_total.toFixed(1)}. ${m.opponent_team_name} ${pts(m.opponent_score)}, projected ${m.opponent_projected_total.toFixed(1)}.${m.win_probability !== null ? ` ${Math.round(m.win_probability)}% chance to win.` : ''} ${m.my_yet_to_play} of your starters yet to play, ${m.my_in_play} playing now.`;
  const open = () => router.push({ pathname: '/matchup/[id]', params: { id: String(m.matchup_id) } });

  return (
    <NeonPanel color={isLive ? Colors.live : props.color} contentStyle={styles.card}>
      <View style={styles.header}>
        {/* October's spider-web emblem and the like (lib/seasonal.ts). */}
        <Image source={seasonalEmblem()} style={styles.emblem} contentFit="contain" />
        <Display style={styles.league} numberOfLines={2}>
          {props.leagueName ?? 'Your Week'}
        </Display>
        {isLive && (
          <View style={styles.livePill}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>Live</Text>
          </View>
        )}
        {myWeek.week !== null && (
          <View style={styles.weekPill}>
            <Text style={styles.weekText}>
              {m.is_playoff ? 'Playoffs · ' : ''}Week {myWeek.week}
            </Text>
          </View>
        )}
      </View>

      <Pressable onPress={open} accessibilityRole="button" accessibilityLabel={scoreLabel} accessibilityHint="Opens the matchup" style={({ pressed }) => pressed && styles.pressed}>
        <View style={styles.dotted} />
        <View style={styles.scores}>
          <ScoreBlock name={myWeek.team_name} logoUrl={m.my_logo_url} score={m.my_score} projected={m.my_projected_total} lead={winning} />
          <ScoreBlock
            name={m.opponent_team_name}
            logoUrl={m.opponent_logo_url}
            score={m.opponent_score}
            projected={m.opponent_projected_total}
            lead={!winning}
            right
          />
        </View>

        {m.win_probability !== null && (
          <WinProbabilityBar left={m.win_probability} right={Math.round((100 - m.win_probability) * 10) / 10} />
        )}

        <View style={styles.dotted} />
        <View style={styles.infoRow}>
          <TeamInfo
            name={myWeek.team_name}
            powerRank={myWeek.power_rank}
            ownerName={m.my_owner_name}
            record={m.record}
            streak={m.my_result_streak}
            yetToPlay={m.my_yet_to_play}
            inPlay={m.my_in_play}
          />
          <TeamInfo
            name={m.opponent_team_name}
            powerRank={m.opponent_power_rank}
            ownerName={m.opponent_owner_name}
            record={m.opponent_record}
            streak={m.opponent_result_streak}
            yetToPlay={m.opponent_yet_to_play}
            inPlay={m.opponent_in_play}
            right
          />
        </View>
      </Pressable>

      <View style={styles.links}>
        <Pressable onPress={open} hitSlop={8}>
          <Text style={[styles.link, { color: props.color }]}>View full matchup →</Text>
        </Pressable>
        <Pressable onPress={() => router.navigate('/team')} hitSlop={8}>
          <Text style={styles.subtleLink}>My lineup →</Text>
        </Pressable>
      </View>
    </NeonPanel>
  );
}

function ScoreBlock(props: {
  name: string;
  logoUrl: string | null;
  score: number | null;
  projected: number;
  lead: boolean;
  right?: boolean;
}) {
  return (
    <View style={[styles.scoreBlock, props.right && styles.reverse]}>
      <TeamAvatar name={props.name} logoUrl={props.logoUrl} size={56} />
      <View style={props.right ? styles.alignEnd : styles.alignStart}>
        <Text style={[styles.score, !props.lead && styles.scoreTrailing]}>
          {props.score !== null ? props.score.toFixed(1) : '0.0'}
        </Text>
        <Text style={styles.projected}>{props.projected.toFixed(2)}</Text>
      </View>
    </View>
  );
}

// Same layout as the web's WinProbabilityBar: left %, two bars filling
// toward the middle, right %. Probabilities are 0–100.
export function WinProbabilityBar({ left, right }: { left: number; right: number }) {
  return (
    <View style={styles.winRow}>
      <Text style={styles.winPct}>{Math.round(left)}%</Text>
      <View style={styles.winTrack}>
        <View style={[styles.winFill, { width: `${left}%` }]} />
      </View>
      <View style={styles.winGap} />
      <View style={[styles.winTrack, styles.winTrackRight]}>
        <View style={[styles.winFill, { width: `${right}%` }]} />
      </View>
      <Text style={[styles.winPct, styles.textRight]}>{Math.round(right)}%</Text>
    </View>
  );
}

// "W2" green, "L1" red — the web's RecordWithStreak.
export function RecordWithStreak({ record, streak }: { record: string | null; streak: string | null }) {
  if (!record) return null;
  const color = streak?.startsWith('W') ? Colors.win : streak?.startsWith('L') ? Colors.loss : undefined;
  return (
    <Text style={styles.muted}>
      {record}
      {streak && <Text style={color ? { color } : undefined}> ({streak})</Text>}
    </Text>
  );
}

export function RankBadge({ rank }: { rank: number | null | undefined }) {
  if (!rank) return null;
  return (
    <View style={styles.rankBadge}>
      <Text style={styles.rankText}>#{rank}</Text>
    </View>
  );
}

function TeamInfo(props: {
  name: string;
  powerRank: number | null;
  ownerName: string | null;
  record: string | null;
  streak: string | null;
  yetToPlay: number;
  inPlay: number;
  right?: boolean;
}) {
  return (
    <View style={[styles.teamInfo, props.right ? styles.alignEnd : styles.alignStart]}>
      <View style={[styles.nameLine, props.right && styles.reverse]}>
        <Text style={[styles.teamName, props.right && styles.textRight]} numberOfLines={2}>
          {props.name}
        </Text>
        <RankBadge rank={props.powerRank} />
      </View>
      <Text style={[styles.muted, props.right && styles.textRight]}>
        {props.ownerName}
        {props.ownerName && props.record ? ' • ' : ''}
        <RecordWithStreak record={props.record} streak={props.streak} />
      </Text>
      <Text style={[styles.muted, props.right && styles.textRight]}>
        Yet to Play <Text style={styles.count}>({props.yetToPlay})</Text> | In Play{' '}
        <Text style={styles.count}>({props.inPlay})</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.lg, backgroundColor: '#0f1318' },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  emblem: { width: 36, height: 36 },
  league: { flex: 1, fontSize: 18, fontFamily: Fonts.displayBold },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(239,68,68,0.15)',
    borderRadius: Radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.live },
  liveText: { color: '#f87171', fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  weekPill: { backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: Radius.pill, paddingHorizontal: 12, paddingVertical: 4 },
  weekText: { color: 'rgba(255,255,255,0.7)', fontSize: 14, fontWeight: '600' },
  pressed: { opacity: 0.85 },
  dotted: { borderTopWidth: 1, borderStyle: 'dotted', borderColor: 'rgba(255,255,255,0.2)', marginVertical: Spacing.md },
  scores: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.md },
  scoreBlock: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexShrink: 1 },
  reverse: { flexDirection: 'row-reverse' },
  alignStart: { alignItems: 'flex-start' },
  alignEnd: { alignItems: 'flex-end' },
  score: { fontFamily: Fonts.monoBold, fontSize: 30, color: '#fff', fontVariant: ['tabular-nums'] },
  scoreTrailing: { color: 'rgba(255,255,255,0.7)' },
  projected: { color: 'rgba(255,255,255,0.5)', fontSize: 14, marginTop: 4, fontVariant: ['tabular-nums'] },
  winRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.lg },
  winPct: { width: 40, color: Colors.text, fontSize: 14, fontVariant: ['tabular-nums'] },
  winTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.1)', overflow: 'hidden' },
  winTrackRight: { alignItems: 'flex-end' },
  winFill: { height: 8, borderRadius: 4, backgroundColor: Colors.accent },
  winGap: { width: 8 },
  textRight: { textAlign: 'right' },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md },
  teamInfo: { flex: 1, gap: 2 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  teamName: { color: 'rgba(255,255,255,0.8)', fontSize: 16, fontWeight: '600', flexShrink: 1 },
  muted: { color: 'rgba(255,255,255,0.5)', fontSize: 14 },
  count: { color: 'rgba(255,255,255,0.7)', fontWeight: '600' },
  rankBadge: { backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: Radius.pill, paddingHorizontal: 6, paddingVertical: 1 },
  rankText: { color: 'rgba(255,255,255,0.6)', fontSize: 10, fontWeight: '600' },
  links: { flexDirection: 'row', gap: Spacing.lg },
  link: { fontSize: 14 },
  subtleLink: { color: 'rgba(255,255,255,0.5)', fontSize: 14 },
});
