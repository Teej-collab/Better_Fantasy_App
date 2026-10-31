import { Image } from 'expo-image';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ANTON, Elite, EliteCard, EliteLabel, EliteWinBar, eliteText, Hex, SATISFY } from '@/components/elite/Elite';
import { openTeam } from '@/components/league/LeagueUI';
import { MatchupWriteUps } from '@/components/matchup/WriteUps';
import { ShareableCard } from '@/components/ShareableCard';
import { RecordWithStreak } from '@/components/home/YourWeekCard';
import { Text } from '@/components/Text';
import { TeamAvatar } from '@/components/ui';
import { Colors, Radius, Spacing } from '@/constants/theme';
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
import { openPlayer, useMe, useScoringRates } from '@/lib/queries';
import { starterSortIndex } from '@/lib/rosterSlots';
import type { MatchupContextSide, RosterPlayer, WeekMatchupContextItem } from '@/lib/types';

// Port of the web's MatchupDetailPanel (frontend/src/components/
// matchups/): badges and score header, starting lineups (+ bench) side
// by side, the narrative, touchdowns, clutch/choke and bench crime,
// and the all-time head-to-head. Elite pass (2026-10-31, mockup A
// "Jumbotron"): the score is a marquee plate, the lineups duel across a
// slot cell lit for whoever's winning it, and the series is a row of
// W/L cells. The home side is the viewer's when it's their game
// (orientMatchupForViewer), so left is orange and right green.
export function MatchupDetail({ matchup }: { matchup: WeekMatchupContextItem }) {
  const { home, away } = matchup;
  const hasDetail = Boolean(home.clutch_choke || home.bench_crime || away.clutch_choke || away.bench_crime);
  const hasTouchdowns = home.touchdowns.length > 0 || away.touchdowns.length > 0;

  return (
    <View style={styles.panel}>
      <ShareableCard title={`Week ${matchup.week}: ${home.team_name} vs ${away.team_name}`}>
        <Jumbotron matchup={matchup} />
      </ShareableCard>

      <MatchupWriteUps narrative={matchup.narrative} preview={matchup.preview ?? null} week={matchup.week} />

      <EliteCard style={styles.duelCard}>
        <View style={styles.spread}>
          <EliteLabel>HEAD TO HEAD</EliteLabel>
          <Text style={eliteText.small}>Tap points for the breakdown</Text>
        </View>
        <StarterComparison home={home.roster} away={away.roster} season={matchup.season} week={matchup.week} />
      </EliteCard>

      {hasTouchdowns && (
        <EliteCard style={styles.card}>
          <EliteLabel>TOUCHDOWNS</EliteLabel>
          <View style={styles.twoCol}>
            <TouchdownList side={home} color={Elite.orange} />
            <TouchdownList side={away} color={Elite.green} right />
          </View>
        </EliteCard>
      )}

      {hasDetail && (
        <EliteCard style={[styles.card, styles.detailGap]}>
          <TeamDetail side={home} />
          <TeamDetail side={away} />
        </EliteCard>
      )}

      <HeadToHead matchup={matchup} />
    </View>
  );
}

const TIER_COLORS: Record<string, [string, string]> = {
  Legendary: ['#d8b4fe', 'rgba(192,132,252,0.2)'],
  Historic: ['#fcd34d', 'rgba(251,191,36,0.2)'],
  Developing: ['#cbd5e1', 'rgba(148,163,184,0.2)'],
};

function Badge({ text, color, bg }: { text: string; color: string; bg: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeText, { color }]}>{text}</Text>
    </View>
  );
}

// The marquee: both teams, LED scores (the leader lit green), the live
// projections and the win-chance tug bar.
function Jumbotron({ matchup }: { matchup: WeekMatchupContextItem }) {
  const myOwnerId = useMe().data?.owner_id ?? null;
  const { home, away } = matchup;
  const homeMine = home.owner_id === myOwnerId;
  const awayMine = away.owner_id === myOwnerId;
  const [tierColor, tierBg] = TIER_COLORS[matchup.rivalry?.tier ?? ''] ?? TIER_COLORS.Developing;
  const odds = home.win_probability !== null && away.win_probability !== null;
  return (
    <EliteCard tone="orange" style={styles.jumbo}>
      <View style={styles.bulbs} pointerEvents="none" />
      {(matchup.headline || matchup.is_game_of_the_week || matchup.is_rivalry || matchup.is_playoff) && (
        <View style={styles.badges}>
          {matchup.is_game_of_the_week && <Badge text="GAME OF THE WEEK" color="#1a0b00" bg={Elite.peach} />}
          {matchup.headline && <Badge text={matchup.headline.toUpperCase()} color={Elite.blue} bg="rgba(125,211,252,0.15)" />}
          {matchup.is_rivalry && matchup.rivalry && <Badge text={`${matchup.rivalry.emoji ?? '🔥'} ${matchup.rivalry.name}`} color={tierColor} bg={tierBg} />}
          {matchup.is_playoff && <Badge text="PLAYOFFS" color="#c4b5fd" bg="rgba(167,139,250,0.2)" />}
        </View>
      )}
      <View style={styles.teams}>
        <TeamBlock side={home} week={matchup.week} ring={homeMine ? Elite.orange : Elite.grey} />
        <Text style={styles.vs}>vs</Text>
        <TeamBlock side={away} week={matchup.week} ring={awayMine ? Elite.orange : Elite.grey} />
      </View>
      <View style={styles.scores}>
        <ScoreTile side={home} opponent={away} mine={homeMine} />
        <ScoreTile side={away} opponent={home} mine={awayMine} />
      </View>
      {odds && (
        <EliteWinBar
          left={home.win_probability!}
          right={away.win_probability!}
          leftColor={homeMine || !awayMine ? Elite.orange : Elite.green}
          rightColor={awayMine ? Elite.orange : Elite.green}
          leftLabel={`${Math.round(home.win_probability!)}% TO WIN`}
          rightLabel={`${Math.round(away.win_probability!)}%`}
        />
      )}
      {(home.season_points !== null || away.season_points !== null) && (
        <View style={styles.spread}>
          <Text style={eliteText.small}>{home.season_points !== null ? `Season ${home.season_points.toFixed(1)} pts` : ''}</Text>
          <Text style={eliteText.small}>{away.season_points !== null ? `Season ${away.season_points.toFixed(1)} pts` : ''}</Text>
        </View>
      )}
    </EliteCard>
  );
}

// Tapping a team opens its roster on this week (like ESPN's team sheet).
function TeamBlock({ side, week, ring }: { side: MatchupContextSide; week: number; ring: string }) {
  return (
    <Pressable
      onPress={() => openTeam(side.team_id, week)}
      accessibilityRole="button"
      accessibilityLabel={`${side.team_name} roster`}
      style={({ pressed }) => [styles.teamBlock, pressed && { opacity: 0.7 }]}>
      <Hex width={62} color={ring} glow={ring === Elite.orange}>
        <TeamAvatar name={side.owner_name ?? side.team_name} logoUrl={side.logo_url} size={44} />
      </Hex>
      <Text style={styles.teamName} numberOfLines={2}>
        {side.team_name}
      </Text>
      <Text style={[eliteText.small, styles.centerText]}>
        {side.owner_name}
        {side.record ? ' · ' : ''}
        <RecordWithStreak record={side.record} streak={side.result_streak} />
        {side.power_rank ? ` · #${side.power_rank}` : ''}
      </Text>
    </Pressable>
  );
}

// ▲ green / ▼ orange when the live projection has moved from pregame.
function LiveProjection({ live, pregame, small }: { live: number; pregame: number | null; small?: boolean }) {
  const diff = pregame == null ? 0 : live - pregame;
  const arrow = diff >= 0.1 ? '▲' : diff <= -0.1 ? '▼' : null;
  return (
    <Text style={small ? styles.projSmall : styles.proj}>
      {small ? '' : 'Proj '}
      {live.toFixed(1)}
      {arrow && <Text style={{ color: arrow === '▲' ? Elite.green : '#ff9a4a' }}> {arrow}</Text>}
    </Text>
  );
}

function ScoreTile({ side, opponent, mine }: { side: MatchupContextSide; opponent: MatchupContextSide; mine: boolean }) {
  const leading = side.score !== null && opponent.score !== null && side.score > opponent.score;
  return (
    <View style={[styles.scoreTile, { borderColor: leading ? 'rgba(57,255,20,0.35)' : mine ? 'rgba(255,122,26,0.35)' : Elite.line }]}>
      <Text style={[styles.led, leading ? styles.ledLead : mine ? styles.ledMine : null]} numberOfLines={1} adjustsFontSizeToFit>
        {side.score !== null ? side.score.toFixed(1) : '0.0'}
      </Text>
      {side.projected_total !== null && <LiveProjection live={side.projected_total} pregame={side.pregame_projected_total} />}
    </View>
  );
}

function StarterComparison(props: { home: RosterPlayer[]; away: RosterPlayer[]; season: number; week: number }) {
  const [breakdown, setBreakdown] = useState<RosterPlayer | null>(null);
  const [showBench, setShowBench] = useState(false);
  const starterRows = buildComparisonRows(starters(props.home), starters(props.away), starterSortIndex);
  const benchRows = buildComparisonRows(bench(props.home), bench(props.away), benchSortIndex);

  if (starterRows.length === 0) return <Text style={eliteText.small}>No starting lineup set for this week yet.</Text>;

  return (
    <View>
      <Rows rows={starterRows} onBreakdown={setBreakdown} />
      {benchRows.length > 0 && (
        <>
          <Pressable
            onPress={() => setShowBench(!showBench)}
            style={({ pressed }) => [styles.benchToggle, pressed && { opacity: 0.7 }]}
            accessibilityRole="button"
            accessibilityState={{ expanded: showBench }}>
            <Text style={styles.benchToggleText}>{showBench ? 'Hide bench' : 'Bench ›'}</Text>
          </Pressable>
          {showBench && <Rows rows={benchRows} onBreakdown={setBreakdown} bench />}
        </>
      )}
      {breakdown && <ScoreBreakdown player={breakdown} season={props.season} week={props.week} onClose={() => setBreakdown(null)} />}
    </View>
  );
}

// Who's winning a slot: orange for the left (home) side, green for the
// right, grey until both have points.
function slotColor(row: ComparisonRow): string {
  const a = row.home?.points_scored ?? null;
  const b = row.away?.points_scored ?? null;
  if (a === null && b === null) return 'rgba(245,244,236,0.25)';
  if ((a ?? 0) > (b ?? 0)) return Elite.orange;
  if ((b ?? 0) > (a ?? 0)) return Elite.green;
  return 'rgba(245,244,236,0.25)';
}

function Rows({ rows, onBreakdown, bench: isBench }: { rows: ComparisonRow[]; onBreakdown: (p: RosterPlayer) => void; bench?: boolean }) {
  return (
    <View>
      {rows.map((row, i) => {
        const color = isBench ? 'rgba(245,244,236,0.18)' : slotColor(row);
        const lit = color === Elite.orange || color === Elite.green;
        return (
          <View key={i} style={[styles.duel, i > 0 && styles.divided]}>
            <PlayerCell player={row.home} onBreakdown={onBreakdown} winning={lit && color === Elite.orange} />
            <Hex width={42} color={color}>
              <Text style={[styles.slot, { color: lit ? (color === Elite.orange ? Elite.peach : Elite.green) : Elite.cream }]} numberOfLines={1} adjustsFontSizeToFit>
                {row.slot}
              </Text>
            </Hex>
            <PlayerCell player={row.away} onBreakdown={onBreakdown} right winning={lit && color === Elite.green} />
          </View>
        );
      })}
    </View>
  );
}

// One side of a lineup row, like the web's PlayerCell: name (tap for the
// player card) with team logo and injury tags, the stat line once they've
// played (else team, opponent, kickoff and matchup rank), and points
// (tap for the breakdown) over the projection. A live dot while they're
// playing; red-zone players get an RZ tag.
function PlayerCell({ player, onBreakdown, right, winning }: { player: RosterPlayer | null; onBreakdown: (p: RosterPlayer) => void; right?: boolean; winning?: boolean }) {
  if (!player) return <View style={styles.cell} />;
  const logo = teamLogoUrl(player.pro_team);
  const statLine = formatStatLine(player.raw_stats);
  const isLive = player.game_status === 'in_progress';
  const scored = player.points_scored ?? (isLive || player.game_status === 'final' ? 0 : null);
  const rank = !statLine ? formatPositionRank(player.opponent_position_rank, player.position) : null;
  const injury = player.in_game_injury && player.in_game_injury.state !== 'returned' ? IN_GAME_INJURY_LABELS[player.in_game_injury.state] : null;
  const canOpen = typeof player.player_id === 'string';
  const align = right ? styles.alignEnd : styles.alignStart;

  return (
    <View style={[styles.cell, align, player.on_offense && !player.is_redzone && styles.onOffense]}>
      <Pressable disabled={!canOpen} onPress={() => openPlayer(player.player_id)} style={align}>
        <View style={[styles.nameLine, right && styles.reverse]}>
          <Text style={[styles.playerName, right && styles.textRight]} numberOfLines={1}>
            {displayName(player)}
          </Text>
          {player.is_redzone && <Text style={styles.rz}>RZ</Text>}
          {hasInjuryBadge(player.injury_status) && <Text style={styles.injury}>{injuryShortCode(player.injury_status)}</Text>}
          {injury && <Text style={styles.gameInjury}>{injury}</Text>}
        </View>
      </Pressable>
      <View style={[styles.nameLine, right && styles.reverse]}>
        {isLive && <View style={styles.liveDot} />}
        {logo && <Image source={{ uri: logo }} style={styles.teamLogo} contentFit="contain" />}
        <Text style={[styles.cellDetail, right && styles.textRight]} numberOfLines={1}>
          {statLine ??
            `${player.pro_team ?? '—'}${player.next_opponent ? ` ${player.next_opponent}` : ''}${player.game_time ? ` · ${formatGameTime(player.game_time)}` : ''}`}
        </Text>
      </View>
      {rank && (
        <Text style={[styles.cellDetail, right && styles.textRight, { color: positionRankColor(player.opponent_position_rank!.rank) }]}>{rank}</Text>
      )}
      <Pressable disabled={!canOpen || player.points_scored == null} onPress={() => onBreakdown(player)} hitSlop={6}>
        <View style={[styles.pointsLine, right && styles.reverse]}>
          <Text style={[scored != null ? styles.points : styles.pointsProj, winning && styles.pointsWin]}>
            {scored != null ? scored.toFixed(1) : player.on_bye ? 'Bye' : player.points_projected != null ? player.points_projected.toFixed(1) : '—'}
          </Text>
          {scored != null && isLive && player.live_projected != null ? (
            <LiveProjection live={player.live_projected} pregame={player.points_projected} small />
          ) : scored != null && player.points_projected != null ? (
            <Text style={styles.projSmall}>{player.points_projected.toFixed(1)}</Text>
          ) : scored == null && !player.on_bye && player.points_projected != null ? (
            <Text style={styles.projSmall}>proj</Text>
          ) : null}
        </View>
      </Pressable>
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

function TouchdownList({ side, color, right }: { side: MatchupContextSide; color: string; right?: boolean }) {
  return (
    <View style={[styles.tdList, right ? styles.alignEnd : styles.alignStart]}>
      <Text style={eliteText.small}>{side.team_name}</Text>
      {side.touchdowns.length === 0 ? (
        <Text style={styles.faint}>No touchdowns yet</Text>
      ) : (
        side.touchdowns.map((td) => (
          <View key={td.player_name} style={[styles.tdRow, right && styles.reverse]}>
            <Hex width={18} color={color} fill={color} strokeWidth={1} />
            <Text style={styles.tdText}>
              {td.player_name}
              {td.touchdowns > 1 ? <Text style={eliteText.small}> ×{td.touchdowns}</Text> : null}
            </Text>
          </View>
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
      <Text style={styles.detailTeam}>{side.team_name.toUpperCase()}</Text>
      {side.clutch_choke && (
        <View style={[styles.plate, { borderColor: clutch ? 'rgba(57,255,20,0.45)' : 'rgba(255,122,26,0.5)' }]}>
          <Text style={[eliteText.kickerCaps, { color: clutch ? Elite.green : Elite.peach }]}>{clutch ? 'CLUTCH' : 'CHOKE'}</Text>
          <Text style={eliteText.body}>{side.clutch_choke.reason}</Text>
        </View>
      )}
      {side.bench_crime && (
        <View style={[styles.plate, { borderColor: 'rgba(245,244,236,0.2)' }]}>
          <Text style={eliteText.kickerCaps}>BENCH CRIME</Text>
          <Text style={eliteText.body}>+{side.bench_crime.points_diff.toFixed(1)} left on the bench</Text>
        </View>
      )}
    </View>
  );
}

// The all-time series, and the last few meetings as W/L cells from the
// left team's side (oldest first).
function HeadToHead({ matchup }: { matchup: WeekMatchupContextItem }) {
  const h = matchup.head_to_head;
  const { home, away } = matchup;
  const total = h.wins_home + h.wins_away + h.ties;
  return (
    <EliteCard tone="deep" style={styles.series}>
      <Text style={[eliteText.kickerCaps, styles.centerText]}>
        ALL-TIME SERIES{h.last_season !== null ? ` · LAST MET ${h.last_season} WK ${h.last_week}` : ''}
      </Text>
      {total === 0 ? (
        <Text style={[eliteText.small, styles.centerText]}>First meeting between these two.</Text>
      ) : (
        <>
          <Text style={styles.seriesScore} accessibilityLabel={`${home.team_name} ${h.wins_home}, ${away.team_name} ${h.wins_away}${h.ties ? `, ${h.ties} ties` : ''}`}>
            <Text style={h.wins_home >= h.wins_away ? styles.seriesLead : null}>{h.wins_home}</Text> – {h.wins_away}
            {h.ties > 0 ? <Text style={eliteText.small}>{`  (${h.ties} tie${h.ties > 1 ? 's' : ''})`}</Text> : null}
          </Text>
          {h.recent_meetings.length > 0 && (
            <View style={styles.chain}>
              {h.recent_meetings.map((g, i) => {
                const result = g.tie ? 'T' : g.home_won ? 'W' : 'L';
                const won = result === 'W';
                return (
                  <View key={i} style={styles.chainItem} accessible accessibilityLabel={`${g.season} week ${g.week}: ${g.home_score.toFixed(1)} to ${g.away_score.toFixed(1)}`}>
                    <Hex width={40} color={won ? Elite.peach : 'rgba(245,244,236,0.3)'} fill={won ? Elite.orange : 'rgba(245,244,236,0.12)'} glow={won && i === h.recent_meetings.length - 1}>
                      <Text style={[styles.chainResult, { color: won ? '#1a0b00' : Elite.cream }]}>{result}</Text>
                    </Hex>
                    <Text style={styles.chainLabel}>
                      ’{String(g.season).slice(-2)} W{g.week}
                    </Text>
                    <Text style={styles.chainScore}>
                      {g.home_score.toFixed(1)}–{g.away_score.toFixed(1)}
                    </Text>
                  </View>
                );
              })}
            </View>
          )}
          <Text style={[eliteText.small, styles.centerText]}>From {home.team_name}&apos;s side</Text>
        </>
      )}
    </EliteCard>
  );
}

const styles = StyleSheet.create({
  panel: { gap: Spacing.lg },
  card: { padding: 16, gap: 10 },
  detailGap: { gap: Spacing.lg },
  spread: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  centerText: { textAlign: 'center' },
  // Jumbotron
  jumbo: { padding: 16, paddingTop: 18, gap: 14, backgroundColor: Elite.deep },
  bulbs: { position: 'absolute', top: 6, left: 6, right: 6, bottom: 6, borderRadius: 18, borderWidth: 2, borderStyle: 'dotted', borderColor: 'rgba(255,178,122,0.55)' },
  badges: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6 },
  badge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontSize: 11, fontWeight: '800', letterSpacing: 1.5 },
  teams: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  teamBlock: { flex: 1, alignItems: 'center', gap: 6 },
  teamName: { color: Elite.cream, fontSize: 15, fontWeight: '800', textAlign: 'center' },
  vs: { fontFamily: SATISFY, fontSize: 22, lineHeight: 28, color: Elite.peach, marginTop: 20 },
  scores: { flexDirection: 'row', gap: 10 },
  scoreTile: { flex: 1, alignItems: 'center', paddingVertical: 10, paddingHorizontal: 4, borderRadius: 16, backgroundColor: '#0f141b', borderWidth: 1 },
  led: { fontFamily: ANTON, fontSize: 46, lineHeight: 54, letterSpacing: 2, color: Elite.cream },
  ledLead: { color: Elite.green, textShadowColor: 'rgba(57,255,20,0.7)', textShadowRadius: 12 },
  ledMine: { color: Elite.peach, textShadowColor: 'rgba(255,122,26,0.7)', textShadowRadius: 12 },
  proj: { color: Elite.soft, fontSize: 12, fontVariant: ['tabular-nums'] },
  projSmall: { color: 'rgba(245,244,236,0.5)', fontSize: 10.5, fontVariant: ['tabular-nums'] },
  // Head to head (lineups)
  duelCard: { paddingHorizontal: 12, paddingTop: 12, paddingBottom: 4, gap: 4 },
  duel: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10 },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.08)' },
  slot: { fontSize: 10, fontWeight: '800', letterSpacing: 0.3, maxWidth: 34, textAlign: 'center' },
  cell: { flex: 1, gap: 2, minWidth: 0, borderRadius: 8, paddingHorizontal: 2 },
  onOffense: { backgroundColor: 'rgba(251,191,36,0.07)' },
  alignStart: { alignItems: 'flex-start' },
  alignEnd: { alignItems: 'flex-end' },
  reverse: { flexDirection: 'row-reverse' },
  textRight: { textAlign: 'right' },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: '100%' },
  playerName: { color: Elite.cream, fontSize: 13, fontWeight: '700', flexShrink: 1 },
  rz: { fontSize: 9, fontWeight: '800', letterSpacing: 1, color: '#1a0b00', backgroundColor: Elite.orange, borderRadius: 4, paddingHorizontal: 4, overflow: 'hidden' },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: Elite.green, shadowColor: Elite.green, shadowOpacity: 0.9, shadowRadius: 4, shadowOffset: { width: 0, height: 0 } },
  teamLogo: { width: 12, height: 12 },
  injury: { color: '#f87171', fontSize: 11, fontWeight: '700' },
  gameInjury: { color: '#f87171', fontSize: 9, fontWeight: '700', textTransform: 'uppercase', backgroundColor: 'rgba(239,68,68,0.15)', paddingHorizontal: 3, borderRadius: 3, overflow: 'hidden' },
  cellDetail: { color: 'rgba(245,244,236,0.58)', fontSize: 11, flexShrink: 1 },
  pointsLine: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  points: { fontFamily: ANTON, color: Elite.cream, fontSize: 19, lineHeight: 24 },
  pointsWin: { color: Elite.green },
  pointsProj: { fontFamily: ANTON, color: 'rgba(245,244,236,0.5)', fontSize: 19, lineHeight: 24 },
  benchToggle: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.08)' },
  benchToggleText: { color: 'rgba(245,244,236,0.75)', fontSize: 13, fontWeight: '600' },
  // Touchdowns, clutch/choke, bench crime
  twoCol: { flexDirection: 'row', gap: Spacing.lg },
  tdList: { flex: 1, gap: 6 },
  tdRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tdText: { color: Elite.cream, fontSize: 13, fontWeight: '600', flexShrink: 1 },
  faint: { color: 'rgba(245,244,236,0.4)', fontSize: 12 },
  detailBlock: { gap: 8 },
  detailTeam: { fontFamily: ANTON, fontSize: 18, lineHeight: 24, color: Elite.cream },
  plate: { borderRadius: 14, borderWidth: 1, backgroundColor: '#0f141b', padding: 12, gap: 4 },
  // The series
  series: { padding: 16, gap: 12, alignItems: 'center' },
  seriesScore: { fontFamily: ANTON, fontSize: 42, lineHeight: 50, letterSpacing: 2, color: Elite.cream },
  seriesLead: { color: Elite.peach, textShadowColor: 'rgba(255,122,26,0.7)', textShadowRadius: 12 },
  chain: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
  chainItem: { alignItems: 'center', gap: 3 },
  chainResult: { fontFamily: ANTON, fontSize: 15, lineHeight: 19 },
  chainLabel: { color: Elite.soft, fontSize: 10 },
  chainScore: { color: 'rgba(245,244,236,0.45)', fontSize: 9.5, fontVariant: ['tabular-nums'] },
  // Score breakdown
  muted: { color: 'rgba(255,255,255,0.5)', fontSize: 14 },
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
