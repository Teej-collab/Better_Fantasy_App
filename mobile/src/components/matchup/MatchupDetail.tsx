import { Image } from 'expo-image';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ShareableCard } from '@/components/ShareableCard';
import { RecordWithStreak, RankBadge, WinProbabilityBar } from '@/components/home/YourWeekCard';
import { NeonPanel } from '@/components/NeonPanel';
import { Text } from '@/components/Text';
import { TeamAvatar } from '@/components/ui';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { formatGameTime } from '@/lib/format';
import {
  bench,
  benchSortIndex,
  buildComparisonRows,
  displayName,
  formatPositionRank,
  formatStatLine,
  hasInjuryBadge,
  humanizeStatCategory,
  IN_GAME_INJURY_LABELS,
  injuryShortCode,
  positionRankColor,
  starters,
  type ComparisonRow,
} from '@/lib/matchups';
import { nflTeamName, sleeperHeadshotUrl, teamLogoUrl } from '@/lib/nflTeams';
import { positionColor } from '@/lib/positionColors';
import { openPlayer, useScoringRates } from '@/lib/queries';
import { starterSortIndex } from '@/lib/rosterSlots';
import type { MatchupContextSide, RosterPlayer, WeekMatchupContextItem } from '@/lib/types';

// Port of the web's MatchupDetailPanel (frontend/src/components/
// matchups/): badges and score header, starting lineups (+ bench) side
// by side, the narrative, touchdowns, clutch/choke and bench crime,
// and the all-time head-to-head.
export function MatchupDetail({ matchup }: { matchup: WeekMatchupContextItem }) {
  const { home, away } = matchup;
  const hasDetail = Boolean(home.clutch_choke || home.bench_crime || away.clutch_choke || away.bench_crime);
  const hasTouchdowns = home.touchdowns.length > 0 || away.touchdowns.length > 0;

  return (
    <View style={styles.panel}>
      <ShareableCard title={`Week ${matchup.week}: ${home.team_name} vs ${away.team_name}`}>
      <NeonPanel contentStyle={styles.card}>
        {(matchup.is_game_of_the_week || matchup.is_rivalry || matchup.is_playoff) && (
          <View style={styles.badges}>
            {matchup.is_game_of_the_week && <Badge text="⭐ Game of the Week" color="#fcd34d" bg="rgba(251,191,36,0.2)" />}
            {matchup.is_rivalry && matchup.rivalry && <RivalryBadge rivalry={matchup.rivalry} />}
            {matchup.is_playoff && <Badge text="Playoffs" color="#c4b5fd" bg="rgba(167,139,250,0.2)" />}
          </View>
        )}
        <ScoreHeader home={home} away={away} />
      </NeonPanel>
      </ShareableCard>

      <NeonPanel contentStyle={styles.card}>
        <Text style={styles.sectionTitle}>Starting Lineups</Text>
        <StarterComparison home={home.roster} away={away.roster} season={matchup.season} week={matchup.week} />
      </NeonPanel>

      {matchup.narrative && (
        <View style={styles.narrative}>
          <Text style={styles.narrativeText}>{matchup.narrative}</Text>
        </View>
      )}

      {hasTouchdowns && (
        <NeonPanel contentStyle={styles.card}>
          <Text style={styles.sectionTitle}>Touchdowns</Text>
          <View style={styles.twoCol}>
            <TouchdownList side={home} />
            <TouchdownList side={away} right />
          </View>
        </NeonPanel>
      )}

      {hasDetail && (
        <NeonPanel contentStyle={[styles.card, styles.detailGap]}>
          <TeamDetail side={home} />
          <TeamDetail side={away} />
        </NeonPanel>
      )}

      <NeonPanel contentStyle={styles.card}>
        <HeadToHead matchup={matchup} />
      </NeonPanel>
    </View>
  );
}

function Badge({ text, color, bg }: { text: string; color: string; bg: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeText, { color }]}>{text}</Text>
    </View>
  );
}

const TIER_COLORS: Record<string, [string, string]> = {
  Legendary: ['#d8b4fe', 'rgba(192,132,252,0.2)'],
  Historic: ['#fcd34d', 'rgba(251,191,36,0.2)'],
  Developing: ['#cbd5e1', 'rgba(148,163,184,0.2)'],
};

function RivalryBadge({ rivalry }: { rivalry: NonNullable<WeekMatchupContextItem['rivalry']> }) {
  const [color, bg] = TIER_COLORS[rivalry.tier ?? ''] ?? TIER_COLORS.Developing;
  return <Badge text={`${rivalry.emoji ?? '🔥'} ${rivalry.name}`} color={color} bg={bg} />;
}

// ▲ green / ▼ red when the live projection has moved from pregame.
function LiveProjection({ live, pregame, small }: { live: number; pregame: number | null; small?: boolean }) {
  const diff = pregame == null ? 0 : live - pregame;
  const arrow = diff >= 0.1 ? '▲' : diff <= -0.1 ? '▼' : null;
  return (
    <Text style={small ? styles.projSmall : styles.proj}>
      {live.toFixed(1)}
      {arrow && <Text style={{ color: arrow === '▲' ? '#34d399' : '#f87171' }}> {arrow}</Text>}
    </Text>
  );
}

function ScoreHeader({ home, away }: { home: MatchupContextSide; away: MatchupContextSide }) {
  return (
    <View style={styles.scoreHeader}>
      <View style={styles.scoreRow}>
        <TeamScore side={home} />
        <TeamScore side={away} right />
      </View>
      {home.win_probability !== null && away.win_probability !== null && (
        <WinProbabilityBar left={home.win_probability} right={away.win_probability} />
      )}
    </View>
  );
}

function TeamScore({ side, right }: { side: MatchupContextSide; right?: boolean }) {
  const align = right ? styles.alignEnd : styles.alignStart;
  return (
    <View style={[styles.teamScore, align]}>
      <View style={[styles.logoScore, right && styles.reverse]}>
        <TeamAvatar name={side.owner_name ?? side.team_name} logoUrl={side.logo_url} size={56} />
        <View style={align}>
          <Text style={styles.bigScore}>{side.score !== null ? side.score.toFixed(1) : '0.0'}</Text>
          {side.projected_total !== null && <LiveProjection live={side.projected_total} pregame={side.pregame_projected_total} />}
        </View>
      </View>
      <View style={[styles.nameRow, right && styles.reverse]}>
        <Text style={[styles.teamName, right && styles.textRight]} numberOfLines={2}>
          {side.team_name}
        </Text>
        <RankBadge rank={side.power_rank} />
      </View>
      <Text style={[styles.muted, right && styles.textRight]}>
        {side.owner_name}
        {side.record ? ' • ' : ''}
        <RecordWithStreak record={side.record} streak={side.result_streak} />
      </Text>
      {side.season_points !== null && <Text style={styles.faint}>Season {side.season_points.toFixed(1)}</Text>}
    </View>
  );
}

function StarterComparison(props: { home: RosterPlayer[]; away: RosterPlayer[]; season: number; week: number }) {
  const [breakdown, setBreakdown] = useState<RosterPlayer | null>(null);
  const starterRows = buildComparisonRows(starters(props.home), starters(props.away), starterSortIndex);
  const benchRows = buildComparisonRows(bench(props.home), bench(props.away), benchSortIndex);

  if (starterRows.length === 0) return <Text style={styles.muted}>No starting lineup set for this week yet.</Text>;

  return (
    <View>
      <Rows rows={starterRows} onBreakdown={setBreakdown} />
      {benchRows.length > 0 && (
        <View style={styles.benchBlock}>
          <Text style={styles.benchTitle}>Bench</Text>
          <Rows rows={benchRows} onBreakdown={setBreakdown} />
        </View>
      )}
      {breakdown && (
        <ScoreBreakdown player={breakdown} season={props.season} week={props.week} onClose={() => setBreakdown(null)} />
      )}
    </View>
  );
}

function Rows({ rows, onBreakdown }: { rows: ComparisonRow[]; onBreakdown: (p: RosterPlayer) => void }) {
  return (
    <View>
      {rows.map((row, i) => (
        <View key={i} style={[styles.compRow, i > 0 && styles.divided]}>
          <PlayerCell player={row.home} onBreakdown={onBreakdown} />
          <Text style={styles.slot}>{row.slot}</Text>
          <PlayerCell player={row.away} onBreakdown={onBreakdown} right />
        </View>
      ))}
    </View>
  );
}

// One side of a lineup row, like the web's PlayerCell: name (tap for the
// player card) with team logo and injury tags, the stat line once they've
// played (else team, opponent, kickoff and matchup rank), and points
// (tap for the breakdown) over the projection. Red-zone and on-offense
// players are highlighted.
function PlayerCell({ player, onBreakdown, right }: { player: RosterPlayer | null; onBreakdown: (p: RosterPlayer) => void; right?: boolean }) {
  if (!player) return <View style={styles.cell} />;
  const logo = teamLogoUrl(player.pro_team);
  const statLine = formatStatLine(player.raw_stats);
  const isLive = player.game_status === 'in_progress';
  const scored = player.points_scored ?? (isLive || player.game_status === 'final' ? 0 : null);
  const rank = !statLine ? formatPositionRank(player.opponent_position_rank, player.position) : null;
  const injury = player.in_game_injury && player.in_game_injury.state !== 'returned' ? IN_GAME_INJURY_LABELS[player.in_game_injury.state] : null;
  const canOpen = typeof player.player_id === 'string';

  return (
    <View
      style={[
        styles.cell,
        player.is_redzone ? styles.redzone : player.on_offense ? styles.onOffense : null,
        // The position stripe on each side's outer edge, like the web lineup.
        right ? { borderRightWidth: 3, borderRightColor: positionColor(player.position) } : { borderLeftWidth: 3, borderLeftColor: positionColor(player.position) },
      ]}>
      <View style={[styles.cellTop, right && styles.reverse]}>
        <Pressable disabled={!canOpen} onPress={() => openPlayer(player.player_id)} style={styles.cellName}>
          <View style={[styles.nameLine, right && styles.reverse]}>
            <Text style={[styles.playerName, !isLive && styles.dim, right && styles.textRight]} numberOfLines={2}>
              {displayName(player)}
            </Text>
            {logo && <Image source={{ uri: logo }} style={styles.teamLogo} contentFit="contain" />}
            {hasInjuryBadge(player.injury_status) && <Text style={styles.injury}>{injuryShortCode(player.injury_status)}</Text>}
            {injury && <Text style={styles.gameInjury}>{injury}</Text>}
          </View>
        </Pressable>
        <Pressable disabled={!canOpen || player.points_scored == null} onPress={() => onBreakdown(player)} hitSlop={6}>
          <View style={right ? styles.alignStart : styles.alignEnd}>
            <Text style={scored != null ? styles.points : styles.pointsProj}>
              {scored != null ? scored.toFixed(1) : player.points_projected != null ? player.points_projected.toFixed(1) : '—'}
            </Text>
            {scored != null && isLive && player.live_projected != null ? (
              <LiveProjection live={player.live_projected} pregame={player.points_projected} small />
            ) : (
              scored != null && player.points_projected != null && <Text style={styles.projSmall}>{player.points_projected.toFixed(1)}</Text>
            )}
          </View>
        </Pressable>
      </View>
      <Text style={[styles.cellDetail, right && styles.textRight]}>
        {statLine ??
          `${player.pro_team ?? '—'}${player.next_opponent ? ` ${player.next_opponent}` : ''}${player.game_time ? ` · ${formatGameTime(player.game_time)}` : ''}`}
      </Text>
      {rank && (
        <Text style={[styles.cellDetail, right && styles.textRight, { color: positionRankColor(player.opponent_position_rank!.rank) }]}>
          {rank}
        </Text>
      )}
    </View>
  );
}

// The web's ScoreBreakdownModal: each scoring stat × this season's rate.
function ScoreBreakdown({ player, season, week, onClose }: { player: RosterPlayer; season: number; week: number; onClose: () => void }) {
  const rates = useScoringRates(season).data ?? {};
  const rows = Object.entries(player.raw_stats ?? {})
    .map(([key, count]) => ({ key, label: humanizeStatCategory(key), rate: rates[key] ?? 0, count }))
    .filter((r) => r.count !== 0 && r.rate !== 0)
    .map((r) => ({ ...r, score: r.rate * r.count }))
    .sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
  const opp = player.next_opponent?.replace(/^(vs|@)\s*/, '').trim() || null;
  const headshot = typeof player.player_id === 'string' ? sleeperHeadshotUrl(player.player_id) : null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.breakdown} onPress={() => {}}>
          <ScrollView contentContainerStyle={styles.breakdownContent}>
            <View style={styles.breakdownHead}>
              {headshot && <Image source={{ uri: headshot }} style={styles.headshot} contentFit="cover" />}
              <Text style={styles.breakdownName}>{player.player_name}</Text>
              <Text style={styles.muted}>
                Week {week}
                {opp ? ` vs. ${nflTeamName(opp)}` : ''}
              </Text>
            </View>
            <View style={styles.breakdownRow}>
              <Text style={[styles.bdHead, styles.flex]}>Scoring Category</Text>
              <Text style={[styles.bdHead, styles.bdNum]}>Pts Per</Text>
              <Text style={[styles.bdHead, styles.bdCount]}>#</Text>
              <Text style={[styles.bdHead, styles.bdNum]}>Score</Text>
            </View>
            {rows.length === 0 ? (
              <Text style={styles.muted}>No scoring stats recorded yet.</Text>
            ) : (
              rows.map((r) => (
                <View key={r.key} style={[styles.breakdownRow, styles.divided]}>
                  <Text style={[styles.bdText, styles.flex]}>{r.label}</Text>
                  <Text style={[styles.bdMuted, styles.bdNum]}>{r.rate}</Text>
                  <Text style={[styles.bdMuted, styles.bdCount]}>{r.count}</Text>
                  <Text style={[styles.bdScore, styles.bdNum]}>{r.score.toFixed(1)}</Text>
                </View>
              ))
            )}
            <View style={[styles.breakdownRow, styles.divided]}>
              <Text style={[styles.bdTotal, styles.flex]}>Total</Text>
              <Text style={styles.bdTotal}>{(player.points_scored ?? 0).toFixed(1)}</Text>
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function TouchdownList({ side, right }: { side: MatchupContextSide; right?: boolean }) {
  return (
    <View style={[styles.tdList, right ? styles.alignEnd : styles.alignStart]}>
      <Text style={styles.small}>{side.team_name}</Text>
      {side.touchdowns.length === 0 ? (
        <Text style={styles.faint}>No touchdowns yet</Text>
      ) : (
        side.touchdowns.map((td) => (
          <Text key={td.player_name} style={styles.tdText}>
            🏈 {td.player_name}
            {td.touchdowns > 1 ? ` ×${td.touchdowns}` : ''}
          </Text>
        ))
      )}
    </View>
  );
}

function TeamDetail({ side }: { side: MatchupContextSide }) {
  if (!side.clutch_choke && !side.bench_crime) return null;
  const clutch = side.clutch_choke?.label === 'clutch';
  return (
    <View style={styles.detailBlock}>
      <Text style={styles.sectionTitle}>{side.team_name}</Text>
      <View style={styles.badges}>
        {side.clutch_choke && (
          <Badge
            text={`${clutch ? '🎯 Clutch' : '😬 Choke'} — ${side.clutch_choke.reason}`}
            color={clutch ? '#6ee7b7' : '#fda4af'}
            bg={clutch ? 'rgba(52,211,153,0.2)' : 'rgba(251,113,133,0.2)'}
          />
        )}
        {side.bench_crime && (
          <Badge
            text={`💀 Bench crime: +${side.bench_crime.points_diff.toFixed(1)} left on the bench`}
            color="#cbd5e1"
            bg="rgba(148,163,184,0.2)"
          />
        )}
      </View>
    </View>
  );
}

function HeadToHead({ matchup }: { matchup: WeekMatchupContextItem }) {
  const h = matchup.head_to_head;
  const { home, away } = matchup;
  const total = h.wins_home + h.wins_away + h.ties;
  return (
    <View style={styles.h2h}>
      <Text style={styles.h2hTitle}>All-time head-to-head</Text>
      {total === 0 ? (
        <Text style={styles.muted}>First meeting between these two.</Text>
      ) : (
        <>
          <Text style={styles.h2hLine}>
            {home.team_name} {h.wins_home} – {h.wins_away} {away.team_name}
            {h.ties > 0 ? ` (${h.ties} tie${h.ties > 1 ? 's' : ''})` : ''}
            {h.last_season !== null && <Text style={styles.muted}> · last met {h.last_season} Wk {h.last_week}</Text>}
          </Text>
          {h.recent_meetings.length > 0 && (
            <View style={styles.meetings}>
              <View style={[styles.meetingRow, styles.meetingHead]}>
                <Text style={[styles.meetingTeam, styles.textRight]} numberOfLines={1}>
                  {home.team_name}
                </Text>
                <Text style={styles.meetingLabel}>Last {h.recent_meetings.length}</Text>
                <Text style={styles.meetingTeam} numberOfLines={1}>
                  {away.team_name}
                </Text>
              </View>
              {[...h.recent_meetings].reverse().map((g, i) => (
                <View key={i} style={[styles.meetingRow, i > 0 && styles.divided]}>
                  <Text style={[styles.meetingScore, styles.textRight, g.home_won && !g.tie && styles.meetingWin]}>
                    {g.home_score.toFixed(1)}
                  </Text>
                  <Text style={styles.meetingWeek}>
                    {g.season} Wk{g.week}
                  </Text>
                  <Text style={[styles.meetingScore, !g.home_won && !g.tie && styles.meetingWin]}>{g.away_score.toFixed(1)}</Text>
                </View>
              ))}
            </View>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: Spacing.lg },
  card: { padding: Spacing.lg },
  detailGap: { gap: Spacing.lg },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: Spacing.sm },
  badge: { borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontSize: 12, fontWeight: '500' },
  sectionTitle: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: Spacing.sm,
  },
  scoreHeader: { gap: Spacing.lg },
  scoreRow: { flexDirection: 'row', gap: Spacing.md },
  teamScore: { flex: 1, gap: 6 },
  alignStart: { alignItems: 'flex-start' },
  alignEnd: { alignItems: 'flex-end' },
  reverse: { flexDirection: 'row-reverse' },
  textRight: { textAlign: 'right' },
  logoScore: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  bigScore: { fontFamily: Fonts.monoBold, fontSize: 30, color: Colors.text, fontVariant: ['tabular-nums'] },
  proj: { color: 'rgba(255,255,255,0.5)', fontSize: 14, marginTop: 2, fontVariant: ['tabular-nums'] },
  projSmall: { color: 'rgba(255,255,255,0.45)', fontSize: 11, fontVariant: ['tabular-nums'] },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  teamName: { color: Colors.text, fontSize: 16, fontWeight: '600', flexShrink: 1 },
  muted: { color: 'rgba(255,255,255,0.5)', fontSize: 14 },
  faint: { color: 'rgba(255,255,255,0.4)', fontSize: 12 },
  small: { color: 'rgba(255,255,255,0.5)', fontSize: 12 },
  compRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.06)' },
  slot: { width: 40, textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 11, fontWeight: '600', textTransform: 'uppercase' },
  cell: { flex: 1, gap: 2, borderRadius: Radius.md, paddingHorizontal: 6, paddingVertical: 4 },
  redzone: { backgroundColor: 'rgba(239,68,68,0.1)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)' },
  onOffense: { backgroundColor: 'rgba(251,191,36,0.1)', borderWidth: 1, borderColor: 'rgba(251,191,36,0.3)' },
  cellTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  cellName: { flex: 1 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  playerName: { color: Colors.text, fontSize: 12, fontWeight: '600', flexShrink: 1 },
  dim: { color: 'rgba(255,255,255,0.5)' },
  teamLogo: { width: 12, height: 12 },
  injury: { color: '#f87171', fontSize: 11, fontWeight: '700' },
  gameInjury: {
    color: '#f87171',
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
    backgroundColor: 'rgba(239,68,68,0.15)',
    paddingHorizontal: 3,
    borderRadius: 3,
    overflow: 'hidden',
  },
  points: { color: Colors.text, fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  pointsProj: { color: 'rgba(255,255,255,0.5)', fontSize: 14, fontVariant: ['tabular-nums'] },
  cellDetail: { color: 'rgba(255,255,255,0.5)', fontSize: 11 },
  benchBlock: { marginTop: Spacing.md, paddingTop: Spacing.md, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)' },
  benchTitle: { color: 'rgba(255,255,255,0.4)', fontSize: 12, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase' },
  narrative: { backgroundColor: Colors.tile, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  narrativeText: { color: 'rgba(255,255,255,0.5)', fontSize: 14, fontStyle: 'italic' },
  twoCol: { flexDirection: 'row', gap: Spacing.lg },
  tdList: { flex: 1, gap: 4 },
  tdText: { color: Colors.text, fontSize: 14 },
  detailBlock: { gap: 4 },
  h2h: { gap: 4 },
  h2hTitle: { color: 'rgba(255,255,255,0.6)', fontSize: 14, fontWeight: '500' },
  h2hLine: { color: Colors.text, fontSize: 14 },
  meetings: { marginTop: Spacing.sm, borderRadius: Radius.md, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', overflow: 'hidden' },
  meetingHead: { backgroundColor: Colors.tile, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.1)' },
  meetingRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  meetingTeam: { flex: 1, color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: '600' },
  meetingLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: '600', textTransform: 'uppercase' },
  meetingScore: { flex: 1, fontFamily: Fonts.mono, color: 'rgba(255,255,255,0.6)', fontSize: 14, fontVariant: ['tabular-nums'] },
  meetingWin: { color: '#34d399', fontFamily: Fonts.monoBold },
  meetingWeek: { color: 'rgba(255,255,255,0.5)', fontSize: 12, textAlign: 'center' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: Spacing.lg },
  breakdown: { maxHeight: '85%', backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border },
  breakdownContent: { padding: Spacing.xl },
  breakdownHead: { alignItems: 'center', gap: 6, marginBottom: Spacing.lg },
  headshot: { width: 72, height: 72, borderRadius: 36, backgroundColor: Colors.border },
  breakdownName: { color: Colors.text, fontSize: 18, fontWeight: '700' },
  breakdownRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: 10 },
  flex: { flex: 1 },
  bdHead: { color: 'rgba(255,255,255,0.4)', fontSize: 10, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase' },
  bdNum: { width: 52, textAlign: 'right' },
  bdCount: { width: 28, textAlign: 'right' },
  bdText: { color: Colors.text, fontSize: 14 },
  bdMuted: { color: 'rgba(255,255,255,0.5)', fontSize: 14, fontVariant: ['tabular-nums'] },
  bdScore: { color: Colors.text, fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  bdTotal: { color: Colors.text, fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
});
