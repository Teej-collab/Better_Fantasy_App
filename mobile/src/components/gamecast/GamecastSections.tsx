import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { lighten } from '@/components/gamecast/GamecastField';
import { LiveBadge } from '@/components/LiveBadge';
import { Text } from '@/components/Text';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import {
  driveEndYardsToGoal,
  driveResultLabel,
  driveStartYardsToGoal,
  isBigPlay,
  isLive,
  ordinal,
  quarterLabel,
} from '@/lib/gamecast';
import { haptics } from '@/lib/haptics';
import { nflTeamColor, sleeperHeadshotUrl, teamLogoUrl } from '@/lib/nflTeams';
import { openPlayer } from '@/lib/queries';
import { BENCH_SLOT_LABEL, IR_SLOT_LABEL } from '@/lib/rosterSlots';
import type { FantasyImpact, GamecastDrive, GamecastPlay, ImpactPlayer, LiveGame, PlayFantasyPlayer } from '@/lib/types';

// ---- Scoreboard ----

export function Scoreboard({ game, connected }: { game: LiveGame; connected: boolean }) {
  const live = isLive(game);
  const started = game.status !== 'scheduled';
  let status: string;
  if (game.status === 'scheduled') {
    const start = new Date(game.scheduled_start);
    status = `${start.toLocaleDateString(undefined, { weekday: 'short' })} ${start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  } else if (game.status === 'final') status = game.period && game.period >= 5 ? 'Final/OT' : 'Final';
  else if (game.status === 'halftime') status = 'Halftime';
  else status = [game.period_label, game.clock].filter(Boolean).join(' · ');

  const homeLead = game.home_team.score > game.away_team.score;
  const awayLead = game.away_team.score > game.home_team.score;
  const a11y = started
    ? `${game.away_team.name} ${game.away_team.score}, ${game.home_team.name} ${game.home_team.score}. ${status}.`
    : `${game.away_team.name} at ${game.home_team.name}, ${status}.`;

  return (
    <View style={[styles.card, live && { borderColor: Colors.live }]} accessible accessibilityLabel={a11y}>
      {live && (
        <View style={styles.liveRow}>
          <LiveBadge />
          <UpdatedAgo game={game} connected={connected} />
        </View>
      )}
      <View style={styles.scoreboard}>
        <TeamSide team={game.away_team} started={started} possession={live && game.possession_team_abbr === game.away_team.abbr} dim={game.status === 'final' && !awayLead} />
        <View style={styles.statusBlock}>
          <Text style={styles.status} maxFontSizeMultiplier={1.3}>
            {status}
          </Text>
          {live && game.down !== null && game.down > 0 && (
            <Text style={styles.statusDown} maxFontSizeMultiplier={1.3}>
              {ordinal(game.down)} & {game.distance !== null && game.yards_to_goal !== null && game.distance >= game.yards_to_goal ? 'Goal' : game.distance}
            </Text>
          )}
        </View>
        <TeamSide team={game.home_team} started={started} possession={live && game.possession_team_abbr === game.home_team.abbr} dim={game.status === 'final' && !homeLead} />
      </View>
    </View>
  );
}

// An honest staleness clock, re-counted every second from the feed's own
// last_updated (same as the web's GameHeader).
function UpdatedAgo({ game, connected }: { game: LiveGame; connected: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const seconds = Math.max(0, Math.round((now - new Date(game.last_updated).getTime()) / 1000));
  return (
    <Text style={[styles.updated, !connected && { color: Colors.loss }]} maxFontSizeMultiplier={1.3}>
      {connected ? `Updated ${seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m`} ago` : 'Reconnecting…'}
    </Text>
  );
}

function TeamSide(props: { team: LiveGame['home_team']; started: boolean; possession: boolean; dim: boolean }) {
  const color = nflTeamColor(props.team.abbr) ?? Colors.accent;
  const logo = teamLogoUrl(props.team.abbr);
  return (
    <View style={[styles.teamSide, props.dim && styles.dim]}>
      <View style={styles.logoWrap}>
        {logo ? <Image source={{ uri: logo }} style={styles.logo} contentFit="contain" accessible={false} /> : null}
        {props.possession && <View style={[styles.possession, { backgroundColor: lighten(color) }]} />}
      </View>
      <Text style={styles.abbr} maxFontSizeMultiplier={1.3}>
        {props.team.abbr}
      </Text>
      {props.started && (
        <Text style={styles.bigScore} maxFontSizeMultiplier={1.2}>
          {props.team.score}
        </Text>
      )}
    </View>
  );
}

// ---- Last play ----

export function LastPlayCard({ play, fantasy }: { play: GamecastPlay | null; fantasy: PlayFantasyPlayer[] }) {
  if (!play) {
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Last play</Text>
        <Text style={styles.muted}>No plays yet.</Text>
      </View>
    );
  }
  const color = nflTeamColor(play.team_abbr) ?? Colors.accent;
  const showYards = play.yards_gained !== null && play.play_type !== 'penalty' && play.play_type !== 'kickoff' && play.play_type !== 'punt';
  return (
    <View style={[styles.card, styles.lastPlayCard, { borderLeftColor: color }]}>
      <View style={styles.cardTop}>
        <Text style={styles.cardTitle}>Last play</Text>
        <Text style={styles.muted}>
          {quarterLabel(play.period)} {play.clock}
        </Text>
      </View>
      <View style={styles.chips}>
        {play.team_abbr && <Text style={[styles.teamTag, { color: lighten(color) }]}>{play.team_abbr}</Text>}
        {play.down !== null && play.down > 0 && play.distance !== null && (
          <Text style={styles.chipText}>
            {ordinal(play.down)} & {play.distance}
          </Text>
        )}
        {showYards && (
          <Text style={[styles.yards, play.yards_gained! > 0 ? { color: Colors.win } : play.yards_gained! < 0 ? { color: Colors.loss } : null]}>
            {play.yards_gained! > 0 ? '+' : ''}
            {play.yards_gained} yd{Math.abs(play.yards_gained!) === 1 ? '' : 's'}
          </Text>
        )}
        {play.is_scoring_play && <Badge label="Score" color="#f59e0b" />}
        {play.is_turnover && <Badge label="Turnover" color={Colors.live} />}
        {play.is_first_down && !play.is_scoring_play && <Badge label="1st down" color="#38bdf8" />}
      </View>
      <Text style={styles.lastPlay}>{play.description}</Text>
      {fantasy.length > 0 && (
        <View style={styles.fantasyList}>
          {fantasy.map((p) => (
            <PlayFantasyRow key={p.player_id} player={p} />
          ))}
        </View>
      )}
    </View>
  );
}

function PlayFantasyRow({ player }: { player: PlayFantasyPlayer }) {
  // Bench/IR points don't count toward anyone's matchup — shown, dimmed.
  const counts = player.lineup_slot !== BENCH_SLOT_LABEL && player.lineup_slot !== IR_SLOT_LABEL;
  const tag = player.is_mine ? 'You' : player.is_opponent ? 'Opp' : null;
  return (
    <Pressable
      onPress={() => openPlayer(player.player_id)}
      accessibilityRole="button"
      accessibilityLabel={`${player.player_name}, ${player.team_name}${tag === 'You' ? ', your player' : tag === 'Opp' ? ', your opponent' : ''}${counts ? '' : ', on the bench'}, ${player.points >= 0 ? 'plus' : 'minus'} ${Math.abs(player.points).toFixed(1)} points`}
      style={[styles.fantasyRow, !counts && styles.dim]}>
      <View style={styles.flex}>
        <Text style={styles.fantasyName} numberOfLines={1}>
          {player.player_name}
        </Text>
        <Text style={styles.muted} numberOfLines={1}>
          {player.position} · {player.team_name}
          {!counts ? ' · Bench' : ''}
        </Text>
      </View>
      {tag && <Badge label={tag} color={player.is_mine ? Colors.win : Colors.live} />}
      <Text style={[styles.fantasyPoints, { color: player.points > 0 ? Colors.win : player.points < 0 ? Colors.loss : Colors.text }]}>
        {player.points > 0 ? '+' : ''}
        {player.points.toFixed(1)}
      </Text>
    </Pressable>
  );
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: `${color}26` }]}>
      <Text style={[styles.badgeText, { color }]} maxFontSizeMultiplier={1.3}>
        {label}
      </Text>
    </View>
  );
}

// ---- Your stake in this game ----

// The fantasy side of the game at a glance: what your players and your
// opponent's have put up in it so far, head to head — then everyone of
// yours and theirs who's playing, and each team's leaders.
export function StakeCard({ impact }: { impact: FantasyImpact }) {
  const mine = sum(impact.your_players);
  const theirs = sum(impact.opponent_players);
  const hasStake = impact.your_players.length > 0 || impact.opponent_players.length > 0;
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Fantasy impact</Text>
      {impact.your_team && hasStake && (
        <View style={styles.stake} accessible accessibilityLabel={`Your players in this game: ${mine.toFixed(1)} points. Your opponent's: ${theirs.toFixed(1)}.`}>
          <View style={styles.stakeSide}>
            <Text style={styles.stakeLabel}>You</Text>
            <Text style={[styles.stakePoints, mine >= theirs && { color: Colors.accent }]} maxFontSizeMultiplier={1.2}>
              {mine.toFixed(1)}
            </Text>
          </View>
          <View style={styles.stakeBar}>
            <View style={[styles.stakeFill, { flex: Math.max(mine, 0.01), backgroundColor: Colors.accent }]} />
            <View style={[styles.stakeFill, { flex: Math.max(theirs, 0.01), backgroundColor: Colors.loss }]} />
          </View>
          <View style={[styles.stakeSide, styles.alignEnd]}>
            <Text style={styles.stakeLabel}>Opponent</Text>
            <Text style={[styles.stakePoints, theirs > mine && { color: Colors.loss }]} maxFontSizeMultiplier={1.2}>
              {theirs.toFixed(1)}
            </Text>
          </View>
        </View>
      )}
      <ImpactGroup title="Your players" subtitle={impact.your_team?.team_name} players={impact.your_players} empty={impact.your_team ? 'None of yours in this game.' : 'No team in this league this season.'} />
      <ImpactGroup title="Opponent's players" subtitle={impact.opponent_team?.team_name} players={impact.opponent_players} empty={impact.opponent_team ? 'None of theirs in this game.' : null} />
      <ImpactGroup title={`${impact.game_leaders.away.abbr} leaders`} players={impact.game_leaders.away.leaders} empty={null} />
      <ImpactGroup title={`${impact.game_leaders.home.abbr} leaders`} players={impact.game_leaders.home.leaders} empty={null} />
    </View>
  );
}

function sum(players: ImpactPlayer[]): number {
  return players.reduce((total, p) => total + (p.points_scored ?? 0), 0);
}

function ImpactGroup(props: { title: string; subtitle?: string; players: ImpactPlayer[]; empty: string | null }) {
  if (props.players.length === 0 && !props.empty) return null;
  return (
    <View style={styles.impactGroup}>
      <View style={styles.cardTop}>
        <Text style={styles.groupTitle}>{props.title}</Text>
        {props.subtitle && (
          <Text style={styles.muted} numberOfLines={1}>
            {props.subtitle}
          </Text>
        )}
      </View>
      {props.players.length === 0 ? (
        <Text style={styles.muted}>{props.empty}</Text>
      ) : (
        props.players.map((p) => <ImpactRow key={`${p.player_id ?? p.player_name}-${p.position}`} player={p} />)
      )}
    </View>
  );
}

function ImpactRow({ player }: { player: ImpactPlayer }) {
  const headshot = sleeperHeadshotUrl(player.player_id);
  const position = player.position === 'DEF' ? 'D/ST' : player.position;
  return (
    <Pressable
      onPress={() => openPlayer(player.player_id)}
      disabled={!player.player_id}
      accessibilityRole="button"
      accessibilityLabel={`${player.player_name}, ${position}, ${player.points_scored.toFixed(1)} points`}
      style={({ pressed }) => [styles.impactRow, pressed && styles.pressed]}>
      {headshot ? (
        <Image source={{ uri: headshot }} style={styles.headshot} contentFit="cover" contentPosition="top" accessible={false} />
      ) : (
        <View style={[styles.headshot, styles.headshotFallback]}>
          <Text style={styles.headshotText}>{position}</Text>
        </View>
      )}
      <Text style={styles.impactName} numberOfLines={1}>
        {player.player_name} <Text style={styles.muted}>{position}</Text>
      </Text>
      <Text style={styles.impactPoints}>{player.points_scored.toFixed(1)}</Text>
    </Pressable>
  );
}

// ---- Scoring summary ----

export function ScoringCard({ game }: { game: LiveGame }) {
  if (game.scoring_plays.length === 0) return null;
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Scoring</Text>
      {[...game.scoring_plays].reverse().map((s, i) => {
        const color = nflTeamColor(s.team_abbr) ?? Colors.accent;
        return (
          <View key={s.play_id} style={[styles.scoreRow, i > 0 && styles.divided]}>
            <View style={[styles.scoreStripe, { backgroundColor: color }]} />
            <View style={styles.flex}>
              <View style={styles.cardTop}>
                <Text style={[styles.scoreType, { color: lighten(color) }]}>
                  {s.team_abbr} {s.score_type}
                </Text>
                <Text style={styles.scoreAfter}>
                  {game.away_team.abbr} {s.away_score_after} – {s.home_score_after} {game.home_team.abbr}
                </Text>
              </View>
              <Text style={styles.playText}>{s.description}</Text>
              <Text style={styles.muted}>
                {quarterLabel(s.period)} {s.clock}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

// ---- Drive chart ----

// Every drive as a bar across a mini field — where it started, how far it
// got, how it ended. A whole game's flow in one glance.
export function DriveChart({ game }: { game: LiveGame }) {
  const [width, setWidth] = useState(0);
  const drives = game.drives.filter((d) => d.plays.some((p) => p.play_type !== 'kickoff'));
  if (drives.length === 0) return null;
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <Text style={styles.cardTitle}>Drive chart</Text>
        <Text style={styles.muted}>{drives.length} drives</Text>
      </View>
      <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={styles.driveList}>
        {width > 0 &&
          [...drives].reverse().map((d) => <DriveBar key={d.drive_id} drive={d} width={width} current={game.current_drive?.drive_id === d.drive_id} />)}
      </View>
    </View>
  );
}

const RESULT_COLORS: Record<string, string> = { TD: '#22c55e', FG: '#facc15', TURNOVER: '#ef4444', FUMBLE: '#ef4444', INT: '#ef4444', SAFETY: '#ef4444' };

function DriveBar({ drive, width, current }: { drive: GamecastDrive; width: number; current: boolean }) {
  const start = driveStartYardsToGoal(drive);
  const end = driveEndYardsToGoal(drive);
  const color = nflTeamColor(drive.team_abbr) ?? Colors.accent;
  const barWidth = width - 120;
  const x = (ytg: number) => barWidth * ((100 - ytg) / 100);
  const left = start !== null ? x(start) : 0;
  const right = end !== null ? x(end) : left;
  const resultColor = drive.result ? (RESULT_COLORS[drive.result] ?? Colors.textSecondary) : current ? Colors.live : Colors.textSecondary;
  const label = current ? 'Now' : drive.result === 'TD' ? 'TD' : drive.result === 'FG' ? 'FG' : driveResultLabel(drive.result, current);
  return (
    <View
      style={styles.driveRow}
      accessible
      accessibilityLabel={`${drive.team_abbr} drive, ${drive.play_count} plays, ${drive.yards} yards, ${driveResultLabel(drive.result, current)}`}>
      <Text style={[styles.driveTeam, { color: lighten(color) }]} maxFontSizeMultiplier={1.2}>
        {drive.team_abbr}
      </Text>
      <View style={[styles.driveTrack, { width: barWidth }]}>
        <View style={[styles.driveMid, { left: barWidth / 2 }]} />
        <View
          style={[
            styles.driveFill,
            { left: Math.min(left, right), width: Math.max(4, Math.abs(right - left)), backgroundColor: color },
            current && { borderWidth: 1, borderColor: '#fff' },
          ]}
        />
      </View>
      <Text style={[styles.driveResult, { color: resultColor }]} numberOfLines={1} maxFontSizeMultiplier={1.2}>
        {label}
      </Text>
    </View>
  );
}

// ---- Play by play ----

type PlayFilter = 'all' | 'big' | 'scoring';
const FILTERS: { key: PlayFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'big', label: 'Big plays' },
  { key: 'scoring', label: 'Scoring' },
];
const PAGE = 25;

export function PlayByPlay({ game }: { game: LiveGame }) {
  const [filter, setFilter] = useState<PlayFilter>('all');
  const [shown, setShown] = useState(PAGE);
  const plays = game.plays.filter((p) =>
    filter === 'all' ? p.play_type !== 'other' || p.is_scoring_play : filter === 'big' ? isBigPlay(p) : p.is_scoring_play,
  );
  if (game.plays.length === 0) return null;
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Play by play</Text>
      <View style={styles.filters}>
        {FILTERS.map((f) => (
          <Pressable
            key={f.key}
            onPress={() => {
              haptics.select();
              setFilter(f.key);
              setShown(PAGE);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: filter === f.key }}
            style={[styles.filter, filter === f.key && styles.filterOn]}>
            <Text style={[styles.filterText, filter === f.key && styles.filterTextOn]}>{f.label}</Text>
          </Pressable>
        ))}
      </View>
      {plays.length === 0 && <Text style={styles.muted}>Nothing here yet.</Text>}
      {plays.slice(0, shown).map((p, i) => (
        <PlayRow key={p.play_id} play={p} divided={i > 0} />
      ))}
      {plays.length > shown && (
        <Pressable onPress={() => setShown((n) => n + PAGE)} accessibilityRole="button" style={styles.more}>
          <Text style={styles.moreText}>Show {Math.min(PAGE, plays.length - shown)} more</Text>
        </Pressable>
      )}
    </View>
  );
}

function PlayRow({ play, divided }: { play: GamecastPlay; divided: boolean }) {
  const color = nflTeamColor(play.team_abbr);
  const big = isBigPlay(play);
  return (
    <View style={[styles.playRow, divided && styles.divided]}>
      <View style={styles.cardTop}>
        <Text style={styles.muted}>
          {play.team_abbr ? <Text style={[styles.playTeam, color ? { color: lighten(color) } : null]}>{play.team_abbr} </Text> : null}
          {quarterLabel(play.period)} {play.clock}
          {play.down !== null && play.down > 0 ? ` · ${ordinal(play.down)} & ${play.distance ?? '?'}` : ''}
        </Text>
        {play.is_scoring_play ? <Badge label="Score" color="#f59e0b" /> : play.is_turnover ? <Badge label="Turnover" color={Colors.live} /> : big ? <Badge label={`+${play.yards_gained}`} color={Colors.win} /> : null}
      </View>
      <Text style={[styles.playText, big && styles.playTextBig]}>{play.description}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  dim: { opacity: 0.5 },
  pressed: { opacity: 0.7 },
  alignEnd: { alignItems: 'flex-end' },
  card: { backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, padding: Spacing.lg, gap: Spacing.sm },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  cardTitle: { color: Colors.textSecondary, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  muted: { color: Colors.textSecondary, fontSize: 12 },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },

  liveRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  updated: { color: Colors.textSecondary, fontSize: 11, fontFamily: Fonts.mono },
  scoreboard: { flexDirection: 'row', alignItems: 'center' },
  teamSide: { flex: 1, alignItems: 'center', gap: 2 },
  logoWrap: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },
  logo: { width: 52, height: 52 },
  possession: { position: 'absolute', right: -6, top: 2, width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: Colors.surface },
  abbr: { color: Colors.text, fontSize: 16, fontFamily: Fonts.displayBold, letterSpacing: 1 },
  bigScore: { color: Colors.text, fontSize: 44, fontFamily: Fonts.monoBold },
  statusBlock: { width: 104, alignItems: 'center', gap: 4 },
  status: { color: Colors.textSecondary, fontSize: 13, fontWeight: '700', textAlign: 'center' },
  statusDown: { color: Colors.text, fontSize: 13, fontFamily: Fonts.monoBold },

  lastPlayCard: { borderLeftWidth: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.sm },
  teamTag: { fontFamily: Fonts.displayBold, fontSize: 14, letterSpacing: 1 },
  chipText: { color: Colors.text, fontSize: 13, fontFamily: Fonts.mono },
  yards: { color: Colors.text, fontSize: 13, fontFamily: Fonts.monoBold },
  badge: { borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  lastPlay: { color: Colors.text, fontSize: 16, lineHeight: 23 },
  fantasyList: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border, paddingTop: Spacing.sm, gap: Spacing.sm },
  fantasyRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  fantasyName: { color: Colors.text, fontSize: 14, fontWeight: '600' },
  fantasyPoints: { fontFamily: Fonts.monoBold, fontSize: 15, minWidth: 48, textAlign: 'right' },

  stake: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.xs },
  stakeSide: { gap: 2 },
  stakeLabel: { color: Colors.textSecondary, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  stakePoints: { color: Colors.text, fontSize: 26, fontFamily: Fonts.monoBold },
  stakeBar: { flex: 1, height: 8, borderRadius: 4, overflow: 'hidden', flexDirection: 'row', gap: 2, backgroundColor: Colors.tile },
  stakeFill: { height: '100%' },
  impactGroup: { gap: 6, paddingTop: Spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  groupTitle: { color: Colors.textSecondary, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  impactRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.tile, borderRadius: Radius.md, paddingHorizontal: Spacing.sm, paddingVertical: 6 },
  headshot: { width: 30, height: 30, borderRadius: 15, backgroundColor: Colors.tileRaised },
  headshotFallback: { alignItems: 'center', justifyContent: 'center' },
  headshotText: { color: Colors.textSecondary, fontSize: 9, fontWeight: '700' },
  impactName: { flex: 1, color: Colors.text, fontSize: 14, fontWeight: '500' },
  impactPoints: { color: Colors.text, fontSize: 15, fontFamily: Fonts.monoBold },

  scoreRow: { flexDirection: 'row', gap: Spacing.sm, paddingTop: Spacing.sm },
  scoreStripe: { width: 3, borderRadius: 2 },
  scoreType: { fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  scoreAfter: { color: Colors.text, fontSize: 13, fontFamily: Fonts.monoBold },

  driveList: { gap: 6 },
  driveRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  driveTeam: { width: 36, fontFamily: Fonts.displayBold, fontSize: 12, letterSpacing: 0.5 },
  driveTrack: { height: 14, borderRadius: 3, backgroundColor: '#173f20' },
  driveMid: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(255,255,255,0.3)' },
  driveFill: { position: 'absolute', top: 2, bottom: 2, borderRadius: 2 },
  driveResult: { width: 60, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', textAlign: 'right' },

  filters: { flexDirection: 'row', gap: Spacing.sm },
  filter: { borderRadius: Radius.pill, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 12, paddingVertical: 5 },
  filterOn: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  filterText: { color: Colors.text, fontSize: 12, fontWeight: '600' },
  filterTextOn: { color: '#06110a' },
  playRow: { paddingTop: Spacing.sm, gap: 4 },
  playTeam: { fontWeight: '800' },
  playText: { color: Colors.text, fontSize: 14, lineHeight: 20 },
  playTextBig: { fontWeight: '600' },
  more: { alignItems: 'center', paddingVertical: Spacing.sm },
  moreText: { color: Colors.accent, fontSize: 13, fontWeight: '700' },
});
