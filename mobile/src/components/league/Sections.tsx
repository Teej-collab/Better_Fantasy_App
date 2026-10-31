import { router } from 'expo-router';
import { Fragment, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import Svg, { Circle, Line, Polyline, Text as SvgText } from 'react-native-svg';

import { BracketExperience } from '@/components/bracket/BracketExperience';
import {
  ANTON,
  Elite,
  EliteCard,
  EliteLabel,
  EliteSegmented,
  EliteWinBar,
  eliteText,
  Hex,
  Honeycomb,
  initials,
  PodiumBoard,
  SATISFY,
  StatTile,
} from '@/components/elite/Elite';
import { PreviewLink } from '@/components/PreviewLink';
import { relativeTime } from '@/components/home/FeedCards';
import { RankBadge } from '@/components/home/YourWeekCard';
import { Muted, openOwner, openTeam, PageTitle } from '@/components/league/LeagueUI';
import { NeonPanel } from '@/components/NeonPanel';
import { ShareableCard } from '@/components/ShareableCard';
import { Text } from '@/components/Text';
import { LoadingState, TeamAvatar } from '@/components/ui';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { useAppearance } from '@/lib/appearance';
import { haptics } from '@/lib/haptics';
import {
  queryClient,
  useAllTimePowerRankings,
  useHouseRules,
  useLatestPowerRankings,
  useLeagueActivity,
  useLeagueChanges,
  useMatchupContext,
  useMe,
  usePlayoffOdds,
  usePolls,
  usePowerRankingsTrend,
  useRivalries,
  useSeasons,
  useSeasonTeams,
  useSeasonWeek,
  useStandings,
  useWeekPowerRankings,
} from '@/lib/queries';
import type { LeagueActivityItem, MatchupContextSide, Poll, Rivalry, StandingsRow, WeekMatchupContextItem } from '@/lib/types';

const MAX_WEEK = 17;

// The elite pass (2026-10-31, canvas "Elite League Pages"): Teams is
// The Hive, Standings gets seed cells and a glowing playoff line, the
// Scoreboard an LED week plate, Power Rankings a throne card and The
// Climb, Rivalries the Fight Card and Activity The Wire. Each section's
// neon title is drawn by the League tab (app/(tabs)/league.tsx).

// The signed-in owner's team this season, if they have one.
function useMyTeamId(season: number | null): number | null {
  const me = useMe().data;
  const teams = useSeasonTeams(season).data ?? [];
  if (me?.owner_id == null) return null;
  return teams.find((t) => t.owner_id === me.owner_id)?.team_id ?? null;
}

// ---- League (overview): The Hive ----

export function LeagueOverview({ season }: { season: number | null }) {
  const me = useMe().data;
  const teams = useSeasonTeams(season).data ?? [];
  const rankings = useLatestPowerRankings(season).data?.rankings ?? [];
  const rankByTeam = new Map(rankings.map((r) => [r.team_id, r.power_rank]));
  const recordByTeam = new Map(rankings.map((r) => [r.team_id, r.record ?? null]));
  const { width } = useWindowDimensions();
  const cell = Math.min(76, Math.floor((width - 2 * Spacing.lg - 3 * 6) / 4));
  const ordered = [...teams].sort(
    (a, b) => (rankByTeam.get(a.team_id) ?? 99) - (rankByTeam.get(b.team_id) ?? 99) || a.team_name.localeCompare(b.team_name),
  );
  const third = Math.ceil(teams.length / 3);
  const mine = me?.owner_id != null ? teams.find((t) => t.owner_id === me.owner_id) : undefined;
  const myRank = mine ? rankByTeam.get(mine.team_id) : undefined;
  const myRecord = mine ? recordByTeam.get(mine.team_id) : null;

  return (
    <View style={styles.gap}>
      <View style={styles.inviteRow}>
        <Text style={eliteText.small}>{rankings.length > 0 ? `${teams.length} teams · lit by power rank` : `${teams.length} teams`}</Text>
        {me?.active_league_id ? (
          <Pressable
            onPress={() => router.push({ pathname: '/leagues', params: { invite: String(me.active_league_id) } })}
            style={({ pressed }) => [styles.inviteButton, pressed && { opacity: 0.8 }]}
            accessibilityRole="button"
            accessibilityLabel="Invite friends to this league">
            <Text style={styles.inviteText}>+ Invite friends</Text>
          </Pressable>
        ) : null}
      </View>
      {me?.active_league_id != null && <ActivePolls leagueId={me.active_league_id} />}

      {teams.length > 0 && (
        <Honeycomb cell={cell}>
          {ordered.map((t) => {
            const rank = rankByTeam.get(t.team_id);
            const isMine = t.team_id === mine?.team_id;
            const color = isMine
              ? Elite.orange
              : rank === undefined
                ? Elite.grey
                : rank <= third
                  ? Elite.green
                  : rank <= 2 * third
                    ? 'rgba(57,255,20,0.5)'
                    : Elite.grey;
            return (
              <Pressable
                key={t.team_id}
                onPress={() => openTeam(t.team_id)}
                accessibilityRole="button"
                accessibilityLabel={`${t.team_name}, ${t.owner_name}${rank ? `, power rank ${rank}` : ''}${isMine ? ', your team' : ''}`}
                style={({ pressed }) => pressed && { opacity: 0.7 }}>
                <Hex width={cell} color={color} fill={isMine ? '#2a1a0c' : Elite.cell} glow={isMine}>
                  <Text style={styles.hiveInitials}>{initials(t.owner_name)}</Text>
                  {rank !== undefined && <Text style={[styles.hiveRank, { color }]}>#{rank}</Text>}
                </Hex>
              </Pressable>
            );
          })}
        </Honeycomb>
      )}

      {mine && (
        <EliteCard tone="orange" style={styles.yourTeam}>
          <View style={styles.spread}>
            <Text style={[eliteText.kickerCaps, { color: Elite.peach }]}>YOUR TEAM</Text>
            <Text style={eliteText.small}>
              {[myRecord, myRank ? `Power #${myRank}` : null].filter(Boolean).join(' · ')}
            </Text>
          </View>
          <Text style={styles.yourTeamName}>{mine.team_name.toUpperCase()}</Text>
          <View style={styles.buttonRow}>
            <Pressable onPress={() => openTeam(mine.team_id)} style={({ pressed }) => [styles.orangeButton, pressed && { opacity: 0.8 }]} accessibilityRole="button">
              <Text style={styles.orangeButtonText}>Roster</Text>
            </Pressable>
            <Pressable onPress={() => openOwner(mine.owner_id)} style={({ pressed }) => [styles.ghostButton, pressed && { opacity: 0.8 }]} accessibilityRole="button">
              <Text style={styles.ghostButtonText}>Owner profile</Text>
            </Pressable>
          </View>
        </EliteCard>
      )}

      <EliteCard>
        {ordered.map((t, i) => {
          const rank = rankByTeam.get(t.team_id);
          const isMine = t.team_id === mine?.team_id;
          const lit = rank !== undefined && rank <= third;
          return (
            <View key={t.team_id} style={[styles.listRow, i > 0 && styles.divided]}>
              <PreviewLink
                href={{ pathname: '/team/[id]', params: { id: String(t.team_id) } }}
                menu={[{ title: 'Owner Profile', icon: 'person.crop.circle', onPress: () => openOwner(t.owner_id) }]}
                style={styles.listMain}>
                <Hex width={36} color={isMine ? Elite.orange : lit ? Elite.green : Elite.grey}>
                  <Text style={styles.cellInitials}>{initials(t.owner_name)}</Text>
                </Hex>
                <View style={styles.flexShrink}>
                  <Text style={eliteText.name}>{t.team_name}</Text>
                  <Text style={eliteText.small}>{t.owner_name}</Text>
                </View>
              </PreviewLink>
              {rank !== undefined && <Text style={[styles.listRank, { color: isMine ? Elite.peach : lit ? Elite.green : Elite.faint }]}>{rank}</Text>}
            </View>
          );
        })}
      </EliteCard>
    </View>
  );
}

// The web's ActivePollCard: open league polls; results show once you vote.
function ActivePolls({ leagueId }: { leagueId: number }) {
  const polls = usePolls(leagueId).data ?? [];
  const accent = useAppearance().accent;
  const [busy, setBusy] = useState<number | null>(null);
  const open = polls.filter((p) => p.status === 'open');
  if (open.length === 0) return null;

  async function vote(poll: Poll, index: number) {
    setBusy(poll.id);
    try {
      const updated = await api.votePoll(leagueId, poll.id, index);
      queryClient.setQueryData<Poll[]>(['polls', leagueId], (prev) => prev?.map((p) => (p.id === poll.id ? updated : p)));
    } finally {
      setBusy(null);
    }
  }

  return (
    <NeonPanel contentStyle={styles.poll}>
      <Text style={styles.pollTitle}>League Poll</Text>
      {open.map((p) => {
        const total = p.results.reduce((a, b) => a + b, 0);
        return (
          <View key={p.id} style={styles.gapSm}>
            <Text style={styles.body}>{p.question}</Text>
            {p.options.map((opt, i) => {
              const mine = p.my_vote === i;
              const pct = total > 0 ? Math.round((p.results[i] / total) * 100) : 0;
              return (
                <Pressable
                  key={i}
                  disabled={busy === p.id}
                  onPress={() => vote(p, i)}
                  style={[styles.pollOption, mine && { borderColor: accent, backgroundColor: `${accent}1a` }]}>
                  {p.my_vote !== null && <View style={[styles.pollFill, { width: `${pct}%` }]} />}
                  <View style={styles.pollLine}>
                    <Text style={styles.body}>
                      {opt} {mine ? '✓' : ''}
                    </Text>
                    {p.my_vote !== null && (
                      <Text style={styles.smallMuted}>
                        {pct}% ({p.results[i]})
                      </Text>
                    )}
                  </View>
                </Pressable>
              );
            })}
          </View>
        );
      })}
    </NeonPanel>
  );
}

// ---- Standings ----

type StandingsView = 'standings' | 'scoreboard' | 'playoffs';

export function StandingsSection({ season, initialView, whatIf }: { season: number | null; initialView?: string; whatIf?: string }) {
  const standingsQ = useStandings(season);
  // A link (a shared what-if from chat) can open straight onto Playoffs.
  const [view, setView] = useState<StandingsView>(initialView === 'playoffs' || whatIf ? 'playoffs' : 'standings');
  // Playoffs is the whole Bracket experience (2026-10), for the current
  // season — the bracket, Your Path and What-If, right in this tab.
  const latestSeason = useSeasons().data?.[0] ?? null;
  const hasPlayoffs = season !== null && season === latestSeason;
  const options: { key: StandingsView; label: string }[] = [
    { key: 'scoreboard', label: 'Scoreboard' },
    { key: 'standings', label: 'Standings' },
    ...(hasPlayoffs ? [{ key: 'playoffs' as const, label: 'Playoffs' }] : []),
  ];

  return (
    <View style={styles.gap}>
      <EliteSegmented options={options} value={view} onChange={setView} />
      {/* Standings and this week's power rankings go to the group chat as images (2026-10-24). */}
      {view === 'standings' && (
        <ShareableCard title={`${season ?? ''} standings`}>
          <StandingsTable season={season} data={standingsQ.data} loading={standingsQ.isPending} />
        </ShareableCard>
      )}
      {view === 'scoreboard' && season !== null && <WeekScoreboard season={season} />}
      {view === 'playoffs' && hasPlayoffs && <BracketExperience embedded initialMode={whatIf ? 'whatif' : undefined} initialW={whatIf} />}
    </View>
  );
}

function StandingsTable(props: {
  season: number | null;
  data: { standings: StandingsRow[]; playoff_team_count?: number | null } | undefined;
  loading: boolean;
}) {
  const me = useMe().data;
  const myTeamId = useMyTeamId(props.season);
  const rankings = useLatestPowerRankings(props.season).data?.rankings ?? [];
  const rankByTeam = new Map(rankings.map((r) => [r.team_id, r.power_rank]));
  // Simulated playoff chances, this season only (2026-10).
  const latestSeason = useSeasons().data?.[0] ?? null;
  const odds = usePlayoffOdds(props.season !== null && props.season === latestSeason ? props.season : null).data;
  const oddsByTeam = new Map((odds?.teams ?? []).map((t) => [t.team_id, t.playoff_pct]));
  if (props.loading) return <LoadingState />;
  const standings = props.data?.standings ?? [];
  const playoffCount = props.data?.playoff_team_count ?? null;
  const isFinal = standings.length > 0 && standings[0].final_rank !== null;
  const showPlayoffLine = !isFinal && playoffCount !== null && playoffCount > 0 && playoffCount < standings.length;
  const toiletBowl = 4;
  const showToilet = !isFinal && standings.length > toiletBowl;
  const format = me?.league_format;
  const rankedByPoints = format?.matchup_type === 'points' || format?.league_type === 'guillotine';
  const note = [isFinal ? 'Final standings.' : null, rankedByPoints ? 'Ranked by total points.' : null].filter(Boolean).join(' ');

  return (
    <View style={styles.gap}>
      {(showPlayoffLine || showToilet || odds) && (
        <View style={styles.tiles}>
          {showPlayoffLine && <StatTile value={`TOP ${playoffCount}`} caption="make the playoffs" color={Elite.green} />}
          {showToilet && <StatTile value={`BOTTOM ${toiletBowl}`} caption="risk the Toilet Bowl" color={Elite.peach} />}
          {odds && <StatTile value="10K" caption="simulated seasons" />}
        </View>
      )}
      {note ? <Text style={eliteText.small}>{note}</Text> : null}
      <EliteCard>
        {standings.map((row, i) => {
          const seed = i + 1;
          const champion = row.final_rank === 1;
          const loser = row.final_rank !== null && row.final_rank === standings.length;
          const games = row.wins + row.losses + row.ties;
          const pct = oddsByTeam.get(row.team_id);
          const isMine = row.team_id === myTeamId;
          const inPlayoffs = showPlayoffLine && seed <= playoffCount!;
          const inToilet = showToilet && seed > standings.length - toiletBowl;
          const seedColor = isMine ? Elite.orange : champion ? '#fcd34d' : inPlayoffs ? Elite.green : inToilet ? 'rgba(255,122,26,0.7)' : Elite.grey;
          const pctColor = pct === undefined ? Elite.cream : pct >= 75 ? Elite.green : pct <= 10 ? Elite.peach : Elite.cream;
          const meterColor = inPlayoffs ? Elite.green : inToilet ? Elite.orange : 'rgba(245,244,236,0.6)';
          return (
            <Fragment key={row.team_id}>
              <View
                style={[
                  styles.seedRow,
                  i > 0 && styles.divided,
                  inToilet && styles.toiletRow,
                  isMine && styles.mineRow,
                  champion && styles.championRow,
                  loser && styles.loserRow,
                ]}>
                <Hex width={36} color={seedColor}>
                  <Text style={[styles.seedText, { color: isMine || inPlayoffs ? seedColor : Elite.cream }]}>{seed}</Text>
                </Hex>
                <View style={styles.flex}>
                  <PreviewLink href={{ pathname: '/team/[id]', params: { id: String(row.team_id) } }} style={styles.nameWithBadge}>
                    <Text style={eliteText.name}>{row.team_name}</Text>
                    <RankBadge rank={rankByTeam.get(row.team_id)} />
                  </PreviewLink>
                  {row.eliminated_week != null && <Pill text={`🪓 Cut Wk ${row.eliminated_week}`} color="#f87171" bg="rgba(239,68,68,0.15)" />}
                  {champion && <Pill text="🏆 Champion" color="#fcd34d" bg="rgba(251,191,36,0.2)" />}
                  {loser && <Pill text="💩 League Loser" color="#d9b98a" bg="rgba(139,90,43,0.3)" />}
                  <Text style={eliteText.small} numberOfLines={2}>
                    {row.owner_name} · {games ? (Number(row.points_for) / games).toFixed(1) : '—'} PPG · PF {Number(row.points_for).toFixed(1)} · PA{' '}
                    {Number(row.points_against).toFixed(1)}
                  </Text>
                </View>
                <Text style={styles.record}>
                  {row.wins}-{row.losses}
                  {row.ties > 0 ? `-${row.ties}` : ''}
                </Text>
                {pct !== undefined && (
                  <View style={styles.pct} accessible accessibilityLabel={`${Math.round(pct)} percent playoff chance`}>
                    <Text style={[styles.pctText, { color: pctColor }]}>{pct > 0 && pct < 1 ? '<1' : Math.round(pct)}%</Text>
                    <View style={styles.meter}>
                      <View style={[styles.meterFill, { width: `${Math.max(2, Math.min(100, pct))}%`, backgroundColor: meterColor }]} />
                    </View>
                  </View>
                )}
              </View>
              {showPlayoffLine && seed === playoffCount && <CutLine label="PLAYOFF LINE" color={Elite.green} />}
              {showToilet && seed === standings.length - toiletBowl && <CutLine label="TOILET BOWL ZONE" color={Elite.orange} dashed />}
            </Fragment>
          );
        })}
      </EliteCard>
    </View>
  );
}

function Pill({ text, color, bg }: { text: string; color: string; bg: string }) {
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={[styles.pillText, { color }]}>{text}</Text>
    </View>
  );
}

// The playoff line (glowing green) and the toilet-bowl cut (dashed orange).
function CutLine({ label, color, dashed }: { label: string; color: string; dashed?: boolean }) {
  return (
    <View style={styles.cutoff}>
      <View style={[styles.cutoffLine, { borderColor: color, borderStyle: dashed ? 'dashed' : 'solid', shadowColor: color }]} />
      <View style={[styles.cutoffPill, { borderColor: color }]}>
        <Text style={[styles.cutoffText, { color: dashed ? Elite.peach : color }]}>{label}</Text>
      </View>
    </View>
  );
}

const STREAK_ICON: Record<string, string> = { hot: '🔥', cold: '🥶', neutral: '' };

// The web's WeekScoreboardBrowser + WeekScoreboardList, as an LED week
// plate with your own matchup pinned first.
function WeekScoreboard({ season }: { season: number }) {
  const me = useMe().data;
  const currentWeek = useSeasonWeek().data?.week ?? 1;
  const [week, setWeek] = useState<number | null>(null);
  const shown = week ?? currentWeek;
  const context = useMatchupContext(season, shown);
  const isMine = (m: WeekMatchupContextItem) => me?.owner_id != null && (m.home.owner_id === me.owner_id || m.away.owner_id === me.owner_id);
  const matchups = [...(context.data?.matchups ?? [])].sort((a, b) => Number(isMine(b)) - Number(isMine(a)));
  const status = shown === currentWeek ? '● CURRENT WEEK' : shown < currentWeek ? 'FINAL' : 'UPCOMING';

  return (
    <View style={styles.gap}>
      <WeekPlate week={shown} status={status} live={shown === currentWeek} onStep={(w) => setWeek(w)} />
      {context.isPending ? (
        <LoadingState />
      ) : matchups.length === 0 ? (
        <Muted>No matchups for this week.</Muted>
      ) : (
        matchups.map((m) => <ScoreboardCard key={m.matchup_id} matchup={m} mine={isMine(m)} myOwnerId={me?.owner_id ?? null} />)
      )}
    </View>
  );
}

export function WeekPlate({ week, status, live, onStep, label }: { week: number; status: string; live: boolean; onStep: (week: number) => void; label?: string }) {
  const arrow = (dir: -1 | 1) => {
    const next = week + dir;
    const disabled = next < 1 || next > MAX_WEEK;
    return (
      <Pressable
        disabled={disabled}
        onPress={() => {
          haptics.select();
          onStep(next);
        }}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={dir < 0 ? 'Previous week' : 'Next week'}
        accessibilityState={{ disabled }}
        style={disabled && styles.disabled}>
        <Hex width={40} color="rgba(57,255,20,0.45)">
          <Text style={styles.plateArrow}>{dir < 0 ? '‹' : '›'}</Text>
        </Hex>
      </Pressable>
    );
  };
  return (
    <View style={styles.plateRow}>
      {arrow(-1)}
      <EliteCard tone="deep" style={styles.plate}>
        <Text style={styles.plateWeek}>{label ?? `WEEK ${week}`}</Text>
        <Text style={[styles.plateStatus, { color: live ? Elite.green : Elite.faint }]}>{status}</Text>
      </EliteCard>
      {arrow(1)}
    </View>
  );
}

function ScoreboardCard({ matchup, mine, myOwnerId }: { matchup: WeekMatchupContextItem; mine: boolean; myOwnerId: number | null }) {
  const open = () => router.push({ pathname: '/matchup/[id]', params: { id: String(matchup.matchup_id) } });
  const { home, away } = matchup;
  const odds = home.win_probability !== null && away.win_probability !== null;
  const homeMine = home.owner_id === myOwnerId;
  const awayMine = away.owner_id === myOwnerId;
  return (
    <EliteCard tone={mine ? 'orange' : 'plain'} style={styles.scoreCard}>
      {mine && <Text style={[eliteText.kickerCaps, styles.scoreKicker, { color: Elite.peach }]}>YOUR MATCHUP</Text>}
      <ScoreRow side={home} opponent={away} onPress={open} />
      <ScoreRow side={away} opponent={home} onPress={open} />
      {odds && (
        <View style={styles.scoreOdds}>
          <EliteWinBar
            left={home.win_probability!}
            right={away.win_probability!}
            leftColor={homeMine ? Elite.orange : Elite.green}
            rightColor={awayMine ? Elite.orange : homeMine ? Elite.green : Elite.blue}
            leftLabel={`${Math.round(home.win_probability!)}%${homeMine ? ' to win' : ''}`}
            rightLabel={`${Math.round(away.win_probability!)}%${awayMine ? ' to win' : ''}`}
          />
        </View>
      )}
    </EliteCard>
  );
}

function ScoreRow({ side, opponent, onPress }: { side: MatchupContextSide; opponent: MatchupContextSide; onPress: () => void }) {
  const leading = side.score !== null && opponent.score !== null && side.score > opponent.score;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.scoreRow, pressed && styles.pressed]}>
      <TeamAvatar name={side.owner_name ?? side.team_name} logoUrl={side.logo_url} size={40} />
      <View style={styles.flex}>
        <View style={styles.nameWithBadge}>
          <Text style={[eliteText.name, !leading && styles.dim]}>
            {side.team_name}
            {STREAK_ICON[side.streak] ? ` ${STREAK_ICON[side.streak]}` : ''}
          </Text>
          <RankBadge rank={side.power_rank} />
        </View>
        <Text style={eliteText.small}>
          {side.owner_name}
          {side.record ? ` · ${side.record}` : ''}
        </Text>
      </View>
      <View style={styles.alignEnd}>
        <Text style={[styles.scoreValue, leading && styles.scoreLead]}>{side.score !== null ? side.score.toFixed(1) : '—'}</Text>
        {side.projected_total !== null && <Text style={eliteText.small}>Proj {side.projected_total.toFixed(1)}</Text>}
      </View>
    </Pressable>
  );
}

// ---- Power Rankings ----

type PowerView = 'week' | 'trend' | 'all-time';

export function PowerRankingsSection({ season }: { season: number | null }) {
  const [view, setView] = useState<PowerView>('week');
  return (
    <View style={styles.gap}>
      <EliteSegmented
        options={[
          { key: 'week', label: 'This Week' },
          { key: 'trend', label: 'Season Trend' },
          { key: 'all-time', label: 'All-Time' },
        ]}
        value={view}
        onChange={setView}
      />
      {view === 'week' && (
        <ShareableCard title="This week's power rankings">
          <PowerWeek season={season} />
        </ShareableCard>
      )}
      {view === 'trend' && <PowerTrend season={season} />}
      {view === 'all-time' && <PowerAllTime />}
      <Text style={eliteText.small}>
        Who&apos;s actually good: record, all-play record, scoring, recent form and margin. Luck is wins above what your scores earned; SoS ranks your
        schedule so far and what&apos;s ahead (1st = hardest).
      </Text>
    </View>
  );
}

function Movement({ movement }: { movement: number | null }) {
  if (movement === null || movement === 0) return <Text style={styles.flat}>—</Text>;
  const up = movement > 0;
  return (
    <Text style={[styles.movement, { color: up ? Elite.green : '#ff9a4a' }]} accessibilityLabel={`${up ? 'up' : 'down'} ${Math.abs(movement)}`}>
      {up ? '▲' : '▼'}
      {Math.abs(movement)}
    </Text>
  );
}

// 1st, 2nd, 11th — schedule-strength ranks (1st = hardest).
function rankLabel(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

function luckLabel(luck: number | undefined): string {
  return luck !== undefined ? `${luck > 0 ? '+' : ''}${luck.toFixed(1)}` : '—';
}

function PowerWeek({ season }: { season: number | null }) {
  const q = useWeekPowerRankings(season);
  const myTeamId = useMyTeamId(season);
  if (q.isPending) return <LoadingState />;
  if (!q.data || q.data.week === null) {
    return <Muted>No power rankings computed for {season} yet — this fills in once a sync has run for at least one completed week.</Muted>;
  }
  const [top, ...rest] = q.data.rankings;
  if (!top) return <Muted>No power rankings yet.</Muted>;
  return (
    <View style={styles.gap}>
      <Text style={[eliteText.kickerCaps, styles.center]}>WEEK {q.data.week}</Text>
      <EliteCard tone="orange" style={styles.throne}>
        <View style={styles.throneTop}>
          <Hex width={78} color={Elite.peach} fill={Elite.orange} glow>
            <Text style={styles.throneRank}>1</Text>
          </Hex>
          <View style={styles.flex}>
            <Text style={styles.throneName}>{top.team_name.toUpperCase()}</Text>
            <Text style={eliteText.small}>
              {top.owner_name}
              {top.record ? ` · ${top.record}` : ''}
              {top.movement === 0 || top.movement === null ? ' · held #1' : top.movement > 0 ? ` · up ${top.movement}` : ''}
              {top.team_id === myTeamId ? ' · you' : ''}
            </Text>
            {top.note && <Text style={styles.powerNote}>{top.note}</Text>}
          </View>
        </View>
        <View style={styles.tiles}>
          <StatTile value={luckLabel(top.luck_wins)} caption="Luck" />
          <StatTile value={top.sos_rank ? rankLabel(top.sos_rank) : '—'} caption="SoS so far" />
          <StatTile value={top.sos_remaining_rank ? rankLabel(top.sos_remaining_rank) : '—'} caption="SoS ahead" />
        </View>
      </EliteCard>
      {rest.length > 0 && (
        <EliteCard>
          {rest.map((r, i) => {
            const isMine = r.team_id === myTeamId;
            const color = isMine ? Elite.orange : r.power_rank <= 4 ? Elite.green : Elite.grey;
            return (
              <View key={r.team_id} style={[styles.powerRow, i > 0 && styles.divided, isMine && styles.mineRow]}>
                <Hex width={40} color={color}>
                  <Text style={[styles.powerRankText, { color: color === Elite.grey ? Elite.cream : color }]}>{r.power_rank}</Text>
                </Hex>
                <View style={styles.flex}>
                  <Text style={eliteText.name}>{r.team_name}</Text>
                  <Text style={eliteText.small}>
                    {r.owner_name}
                    {r.record ? ` · ${r.record}` : ''}
                  </Text>
                  {r.note && <Text style={styles.powerNote}>{r.note}</Text>}
                  <Text style={styles.powerStats}>
                    Luck <Text style={styles.powerStatValue}>{luckLabel(r.luck_wins)}</Text> · SoS{' '}
                    <Text style={styles.powerStatValue}>{r.sos_rank ? rankLabel(r.sos_rank) : '—'}</Text> · Ahead{' '}
                    <Text style={styles.powerStatValue}>{r.sos_remaining_rank ? rankLabel(r.sos_remaining_rank) : '—'}</Text>
                  </Text>
                </View>
                <Movement movement={r.movement} />
              </View>
            );
          })}
        </EliteCard>
      )}
    </View>
  );
}

// The Climb: every team's weekly rank on one chart. Yours is orange, the
// biggest climb green and the biggest fall a dashed blue; tap a team's
// chip to light its line.
function PowerTrend({ season }: { season: number | null }) {
  const me = useMe().data;
  const q = usePowerRankingsTrend(season);
  const { width } = useWindowDimensions();
  const [picked, setPicked] = useState<number | null>(null);
  if (q.isPending) return <LoadingState />;
  const teams = q.data ?? [];
  if (teams.length === 0) return <Muted>No power rankings computed for {season} yet.</Muted>;
  const weeks = Array.from(new Set(teams.flatMap((t) => t.weeks.map((w) => w.week)))).sort((a, b) => a - b);
  const count = teams.length;
  const W = width - 2 * Spacing.lg - 2;
  const H = 280;
  const padX = 18;
  const top = 12;
  const bottom = 26;
  const x = (idx: number) => (weeks.length > 1 ? padX + (idx * (W - 2 * padX)) / (weeks.length - 1) : W / 2);
  const y = (rank: number) => (count > 1 ? top + ((rank - 1) * (H - top - bottom)) / (count - 1) : H / 2);
  const series = teams.map((t) => {
    const pts = weeks
      .map((w, idx) => {
        const rank = t.weeks.find((p) => p.week === w)?.power_rank;
        return rank !== undefined ? { idx, rank } : null;
      })
      .filter((p): p is { idx: number; rank: number } => p !== null);
    const first = pts[0]?.rank ?? null;
    const last = pts[pts.length - 1]?.rank ?? null;
    return { team: t, pts, first, last, delta: first !== null && last !== null ? first - last : 0, line: pts.map((p) => `${x(p.idx).toFixed(1)},${y(p.rank).toFixed(1)}`).join(' ') };
  });
  const mine = series.find((s) => me?.owner_id != null && s.team.owner_id === me.owner_id) ?? null;
  const climb = series.reduce<(typeof series)[number] | null>((best, s) => (s.delta > 0 && (!best || s.delta > best.delta) ? s : best), null);
  const fall = series.reduce<(typeof series)[number] | null>((worst, s) => (s.delta < 0 && (!worst || s.delta < worst.delta) ? s : worst), null);
  const special = new Set([mine?.team.team_id, climb?.team.team_id, fall?.team.team_id, picked].filter((v): v is number => v != null));
  const labelEvery = weeks.length > 9 ? 2 : 1;
  const endDot = (s: (typeof series)[number] | null, color: string, r = 5) => {
    const last = s?.pts[s.pts.length - 1];
    return last ? <Circle cx={x(last.idx)} cy={y(last.rank)} r={r} fill={color} /> : null;
  };
  const pickedSeries = series.find((s) => s.team.team_id === picked) ?? null;

  return (
    <View style={styles.gap}>
      <EliteCard tone="deep" style={styles.climb}>
        <View style={[styles.spread, styles.climbHead]}>
          <EliteLabel>THE CLIMB</EliteLabel>
          <Text style={eliteText.small}>Rank by week</Text>
        </View>
        <Svg width={W} height={H} accessibilityLabel={`Power rank by week for all ${count} teams`}>
          {[1, Math.ceil(count / 2), count].map((r) => (
            <Line key={r} x1={padX} x2={W - padX} y1={y(r)} y2={y(r)} stroke="rgba(245,244,236,0.06)" strokeWidth={1} />
          ))}
          {series
            .filter((s) => !special.has(s.team.team_id) && s.pts.length > 1)
            .map((s) => (
              <Polyline key={s.team.team_id} points={s.line} fill="none" stroke="rgba(245,244,236,0.18)" strokeWidth={1.5} strokeLinejoin="round" />
            ))}
          {fall && fall.pts.length > 1 && <Polyline points={fall.line} fill="none" stroke={Elite.blue} strokeWidth={2.5} strokeDasharray="5 4" strokeLinejoin="round" />}
          {climb && climb.pts.length > 1 && <Polyline points={climb.line} fill="none" stroke={Elite.green} strokeWidth={2.5} strokeLinejoin="round" />}
          {pickedSeries && pickedSeries.pts.length > 1 && <Polyline points={pickedSeries.line} fill="none" stroke={Elite.cream} strokeWidth={3} strokeLinejoin="round" />}
          {mine && mine.pts.length > 1 && <Polyline points={mine.line} fill="none" stroke={Elite.orange} strokeWidth={3.5} strokeLinejoin="round" />}
          {endDot(fall, Elite.blue)}
          {endDot(climb, Elite.green)}
          {endDot(pickedSeries, Elite.cream)}
          {endDot(mine, Elite.orange, 6)}
          {weeks.map((w, idx) =>
            idx % labelEvery === 0 || idx === weeks.length - 1 ? (
              <SvgText key={w} x={x(idx)} y={H - 8} fontSize={10} fontWeight="700" fill="rgba(245,244,236,0.55)" textAnchor="middle">
                {`W${w}`}
              </SvgText>
            ) : null,
          )}
        </Svg>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.legend}>
          {mine && <LegendChip color={Elite.orange} label={`${mine.team.team_name} · you`} />}
          {climb && <LegendChip color={Elite.green} label="Biggest climb" />}
          {fall && <LegendChip color={Elite.blue} label="Biggest fall" dashed />}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.legend}>
          {series.map((s) => {
            const on = picked === s.team.team_id;
            return (
              <Pressable
                key={s.team.team_id}
                onPress={() => {
                  haptics.select();
                  setPicked(on ? null : s.team.team_id);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                style={[styles.teamChip, on && styles.teamChipOn]}>
                <Text style={[styles.teamChipText, on && { color: '#0d1016' }]}>
                  {s.last ?? '—'} · {s.team.team_name}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </EliteCard>
      {(climb || fall) && (
        <View style={styles.tiles}>
          {climb && <MoveCard label="BIGGEST CLIMB" color={Elite.green} name={climb.team.team_name} first={climb.first!} last={climb.last!} />}
          {fall && <MoveCard label="BIGGEST FALL" color={Elite.blue} name={fall.team.team_name} first={fall.first!} last={fall.last!} />}
        </View>
      )}
    </View>
  );
}

function LegendChip({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <View style={styles.legendChip}>
      <View style={[styles.legendSwatch, { borderColor: color, borderStyle: dashed ? 'dashed' : 'solid' }]} />
      <Text style={styles.teamChipText}>{label}</Text>
    </View>
  );
}

function MoveCard({ label, color, name, first, last }: { label: string; color: string; name: string; first: number; last: number }) {
  return (
    <EliteCard style={[styles.moveCard, { borderColor: `${color}59` }]}>
      <Text style={[eliteText.kickerCaps, { color }]}>{label}</Text>
      <Text style={eliteText.name} numberOfLines={2}>
        {name}
      </Text>
      <Text style={styles.moveValue}>
        {rankLabel(first)} → {rankLabel(last)}
      </Text>
    </EliteCard>
  );
}

function PowerAllTime() {
  const q = useAllTimePowerRankings();
  if (q.isPending) return <LoadingState />;
  const cats = (q.data ?? []).filter((c) => c.entries.length > 0);
  if (cats.length === 0) return <Muted>Not enough history yet.</Muted>;
  return (
    <View style={styles.gap}>
      {cats.map((c) => (
        <PodiumBoard
          key={c.key}
          title={c.label}
          entries={c.entries.map((e) => ({
            key: String(e.owner_id),
            name: e.owner_name,
            value: `${e.value.toFixed(e.value % 1 === 0 ? 0 : 1)} ${c.unit}`,
            onPress: () => openOwner(e.owner_id),
          }))}
        />
      ))}
    </View>
  );
}

// ---- Rivalries: the Fight Card ----

const TIER_HEAT: Record<string, number> = { Developing: 1, Historic: 2, Legendary: 3 };

export function RivalriesSection() {
  const q = useRivalries();
  const rivalries = q.data ?? [];
  // The Main Event: the closest series that's been played (the most
  // meetings breaks a tie).
  const played = rivalries.filter((r) => r.all_time_wins_a + r.all_time_wins_b > 0);
  const main = played.reduce<Rivalry | null>((best, r) => {
    if (!best) return r;
    const gap = Math.abs(r.all_time_wins_a - r.all_time_wins_b);
    const bestGap = Math.abs(best.all_time_wins_a - best.all_time_wins_b);
    const games = r.all_time_wins_a + r.all_time_wins_b;
    const bestGames = best.all_time_wins_a + best.all_time_wins_b;
    return gap < bestGap || (gap === bestGap && games > bestGames) ? r : best;
  }, null);
  const ordered = main ? [main, ...rivalries.filter((r) => r.id !== main.id)] : rivalries;
  return (
    <View style={styles.gap}>
      <Text style={[eliteText.small, styles.center]}>Every rivalry, all-time series</Text>
      {q.isPending ? (
        <LoadingState />
      ) : rivalries.length === 0 ? (
        <Muted>No rivalries recorded.</Muted>
      ) : (
        ordered.map((r) => <RivalryCard key={r.id} rivalry={r} main={r.id === main?.id} />)
      )}
    </View>
  );
}

function RivalryCard({ rivalry: r, main }: { rivalry: Rivalry; main: boolean }) {
  const me = useMe().data;
  const [open, setOpen] = useState(false);
  const heat = TIER_HEAT[r.tier ?? ''] ?? 1;
  const name = r.name ?? `${r.owner_a_name} vs ${r.owner_b_name}`;
  const long = (r.description?.length ?? 0) > 140;
  return (
    <EliteCard tone={main ? 'orange' : 'plain'} style={styles.rivalry}>
      <View style={styles.spread}>
        {main ? <Text style={[eliteText.kickerCaps, { color: Elite.peach }]}>MAIN EVENT · CLOSEST SERIES</Text> : <View />}
        {r.tier && (
          <View style={styles.heatRow} accessible accessibilityLabel={`${r.tier} rivalry`}>
            <Text style={eliteText.small}>{r.tier}</Text>
            {[1, 2, 3].map((n) => (
              <View key={n} style={[styles.heatBar, n <= heat && styles.heatOn]} />
            ))}
          </View>
        )}
      </View>
      <View style={main && styles.center}>
        <Text style={[styles.rivalryName, main && styles.rivalryNameMain]}>
          {r.emoji ? `${r.emoji} ` : ''}
          {name.toUpperCase()}
        </Text>
        {r.tagline && <Text style={[styles.tagline, main && styles.center]}>{r.tagline}</Text>}
      </View>
      <View style={styles.fight}>
        <Fighter id={r.owner_a_id} name={r.owner_a_name} leads={r.all_time_wins_a > r.all_time_wins_b} mine={r.owner_a_id === me?.owner_id} />
        <View style={styles.center}>
          <Text style={[styles.series, main && styles.seriesMain]}>
            {r.all_time_wins_a}–{r.all_time_wins_b}
          </Text>
          <Text style={eliteText.kickerCaps}>ALL-TIME</Text>
        </View>
        <Fighter id={r.owner_b_id} name={r.owner_b_name} leads={r.all_time_wins_b > r.all_time_wins_a} mine={r.owner_b_id === me?.owner_id} />
      </View>
      {r.description && (
        <Text style={eliteText.body} numberOfLines={open ? undefined : 3}>
          {r.description}
        </Text>
      )}
      {long && (
        <Pressable onPress={() => setOpen(!open)} hitSlop={8} accessibilityRole="button" accessibilityState={{ expanded: open }}>
          <Text style={eliteText.link}>{open ? 'Show less' : 'Read the whole story'}</Text>
        </Pressable>
      )}
    </EliteCard>
  );
}

function Fighter({ id, name, leads, mine }: { id: number; name: string; leads: boolean; mine: boolean }) {
  const color = mine ? Elite.orange : leads ? Elite.green : Elite.grey;
  return (
    <Pressable onPress={() => openOwner(id)} style={styles.fighter} accessibilityRole="button" accessibilityLabel={`${name}${leads ? ', leads the series' : ''}`}>
      <Hex width={56} color={color} glow={leads || mine}>
        <Text style={[styles.fighterInitials, { color: leads || mine ? color : Elite.cream }]}>{initials(name)}</Text>
      </Hex>
      <Text style={styles.fighterName} numberOfLines={2}>
        {name}
      </Text>
    </Pressable>
  );
}

// ---- History ----

export function HistorySection({ latestSeason }: { latestSeason: number | null }) {
  const accent = useAppearance().accent;
  const currentWeek = useSeasonWeek().data?.week ?? null;
  // The last finished week's recap — each recap page steps to the others.
  const recapWeek = currentWeek !== null ? Math.max(1, currentWeek - 1) : null;
  const chugEnabled = useHouseRules().data?.chugEnabled ?? false;
  const tiles = [
    {
      title: 'Weekly Recaps',
      description: "Every week's story of the league, written up after the Tuesday flip",
      onPress: () =>
        latestSeason !== null &&
        recapWeek !== null &&
        router.push({ pathname: '/recap/[season]/[week]', params: { season: String(latestSeason), week: String(recapWeek) } }),
    },
    {
      title: 'Awards',
      description: "Every season's champion and awards, plus the all-time record book and leaderboards",
      onPress: () => latestSeason !== null && router.push({ pathname: '/awards/[season]', params: { season: String(latestSeason) } }),
    },
    {
      title: 'Player Cards',
      description: "Every owner who's ever been in the league — career stats and a trading card per season",
      onPress: () => router.push('/cards'),
    },
    // Only for leagues with the chug house rule on (2026-10).
    ...(chugEnabled
      ? [{ title: 'Chug', description: "The lifetime leaderboard — who's completed the most, who still owes", onPress: () => router.push('/chug') }]
      : []),
    {
      title: 'Draft Grades',
      description: "Every team's draft grade and recap, plus the full draft board",
      onPress: () => latestSeason !== null && router.push({ pathname: '/draft-grades/[season]', params: { season: String(latestSeason) } }),
    },
  ];
  return (
    <View style={styles.gap}>
      <PageTitle subtitle="The league's past — recaps, awards, trading cards and draft grades.">History</PageTitle>
      {tiles.map((t) => (
        <Pressable key={t.title} onPress={t.onPress}>
          {({ pressed }) => (
            <NeonPanel contentStyle={[styles.tile, pressed && styles.pressedTile]}>
              <View style={styles.tileTitleRow}>
                <View style={[styles.tileDot, { backgroundColor: accent, shadowColor: accent }]} />
                <Text style={styles.tileTitle}>{t.title}</Text>
              </View>
              <Text style={styles.smallMuted}>{t.description}</Text>
            </NeonPanel>
          )}
        </Pressable>
      ))}
    </View>
  );
}

// ---- Activity: The Wire ----

const ACTIVITY_PAGE = 50;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

type WireFilter = 'all' | 'trades' | 'moves' | 'mine';
type RosterItem = Extract<LeagueActivityItem, { kind: 'roster' }>;
type TradeItem = Extract<LeagueActivityItem, { kind: 'trade' }>;
// One card on the wire: a trade, or one owner's adds and drops that day.
type WireCard = { kind: 'trade'; item: TradeItem } | { kind: 'roster'; items: RosterItem[] };

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(today) - start(d)) / 86_400_000);
  if (days === 0) return 'TODAY';
  if (days === 1) return 'YESTERDAY';
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'long' }).toUpperCase();
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).toUpperCase();
}

function involves(item: LeagueActivityItem, ownerId: number | null): boolean {
  if (ownerId === null) return false;
  return item.kind === 'roster' ? item.owner_id === ownerId : item.proposing_owner_id === ownerId || item.receiving_owner_id === ownerId;
}

export function ActivitySection({ season }: { season: number | null }) {
  const me = useMe().data;
  const myOwnerId = me?.owner_id ?? null;
  const teams = useSeasonTeams(season).data ?? [];
  const ownerByTeam = new Map(teams.map((t) => [t.team_id, t.owner_id]));
  const [limit, setLimit] = useState(ACTIVITY_PAGE);
  const [filter, setFilter] = useState<WireFilter>('all');
  const [openedAt] = useState(() => Date.now());
  const q = useLeagueActivity(season, limit);
  const items = q.data ?? [];
  // A full page back means there's probably more behind it.
  const hasMore = items.length >= limit;

  // This week's numbers, from what's loaded.
  const since = openedAt - WEEK_MS;
  const recent = items.filter((i) => new Date(i.timestamp).getTime() >= since);
  const busy = new Map<string, number>();
  for (const i of recent) {
    for (const name of i.kind === 'roster' ? [i.owner_name] : [i.proposing_owner_name, i.receiving_owner_name]) busy.set(name, (busy.get(name) ?? 0) + 1);
  }
  const busiest = [...busy.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;

  const shown = items.filter((i) =>
    filter === 'trades' ? i.kind === 'trade' : filter === 'moves' ? i.kind === 'roster' : filter === 'mine' ? involves(i, myOwnerId) : true,
  );
  // Group by day, and fold one owner's moves that day into one card.
  const days: { label: string; cards: WireCard[] }[] = [];
  for (const item of shown) {
    const label = dayLabel(item.timestamp);
    let day = days[days.length - 1];
    if (!day || day.label !== label) {
      day = { label, cards: [] };
      days.push(day);
    }
    if (item.kind === 'trade') {
      day.cards.push({ kind: 'trade', item });
      continue;
    }
    const same = day.cards.find((c): c is Extract<WireCard, { kind: 'roster' }> => c.kind === 'roster' && c.items[0].owner_id === item.owner_id);
    if (same) same.items.push(item);
    else day.cards.push({ kind: 'roster', items: [item] });
  }

  const filters: { key: WireFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'trades', label: 'Trades' },
    { key: 'moves', label: 'Adds & drops' },
    ...(myOwnerId !== null ? [{ key: 'mine' as const, label: 'Mine' }] : []),
  ];

  return (
    <View style={styles.gap}>
      <Text style={[eliteText.small, styles.center]}>Trades, waiver claims, adds and drops</Text>
      {items.length > 0 && (
        <View style={styles.tiles}>
          <StatTile value={String(recent.length)} caption="moves this week" color={Elite.green} />
          <StatTile value={String(recent.filter((i) => i.kind === 'trade').length)} caption="trades" color={Elite.peach} />
          <StatTile value={busiest ? busiest[0] : '—'} caption={busiest ? `busiest · ${busiest[1]}` : 'busiest'} />
        </View>
      )}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.legend}>
        {filters.map((f) => {
          const on = filter === f.key;
          return (
            <Pressable
              key={f.key}
              onPress={() => {
                haptics.select();
                setFilter(f.key);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              style={[styles.filterChip, on && styles.filterChipOn]}>
              <Text style={[styles.filterText, on && { color: '#06110a' }]}>{f.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {q.isPending ? (
        <LoadingState />
      ) : shown.length === 0 ? (
        <Muted>{items.length === 0 ? 'No activity yet.' : 'Nothing here yet.'}</Muted>
      ) : (
        <View style={styles.wire}>
          <View style={styles.rail} />
          {days.map((day) => (
            <View key={day.label} style={styles.gapSm}>
              <Text style={[eliteText.kickerCaps, styles.dayLabel]}>{day.label}</Text>
              {day.cards.map((card, i) => {
                const mine = card.kind === 'trade' ? involves(card.item, myOwnerId) : card.items[0].owner_id === myOwnerId;
                const trade = card.kind === 'trade';
                return (
                  <View key={i} style={styles.event}>
                    <View style={styles.node}>
                      <Hex width={16} color={mine || trade ? Elite.orange : Elite.green} fill={mine || trade ? Elite.orange : Elite.green} strokeWidth={1} />
                    </View>
                    {card.kind === 'trade' ? (
                      <TradeCard item={card.item} ownerByTeam={ownerByTeam} />
                    ) : (
                      <MovesCard items={card.items} mine={mine} />
                    )}
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      )}
      <CommishChanges />
      {hasMore && (
        <Pressable
          onPress={() => setLimit(limit + ACTIVITY_PAGE)}
          disabled={q.isFetching}
          style={({ pressed }) => [styles.loadMore, pressed && { opacity: 0.6 }]}
          accessibilityRole="button">
          <Text style={styles.loadMoreText}>{q.isFetching ? 'Loading…' : 'Load more'}</Text>
        </Pressable>
      )}
    </View>
  );
}

const SOURCE_TAG: Record<RosterItem['source'], string | null> = { free_agent: null, waiver: 'WAIVER CLAIM', commissioner: 'COMMISSIONER' };

function MovesCard({ items, mine }: { items: RosterItem[]; mine: boolean }) {
  const first = items[0];
  const tags = Array.from(new Set(items.map((i) => SOURCE_TAG[i.source]).filter(Boolean)));
  return (
    <EliteCard style={[styles.wireCard, mine && styles.wireCardMine]}>
      <View style={styles.spread}>
        <Text style={[eliteText.name, styles.flexShrink]}>
          {first.owner_name}
          <Text style={eliteText.small}>
            {'  '}
            {first.team_name}
            {mine ? ' · you' : ''}
          </Text>
        </Text>
        <Text style={eliteText.small}>
          {relativeTime(first.timestamp)}
          {items.length > 1 ? ` · ${items.length} moves` : ''}
        </Text>
      </View>
      {tags.length > 0 && <Text style={styles.sourceTag}>{tags.join(' · ')}</Text>}
      {items.map((i, n) => (
        <View key={n} style={styles.chipRow}>
          {i.added_player_name && <PlayerChip added name={i.added_player_name} />}
          {i.dropped_player_name && <PlayerChip name={i.dropped_player_name} />}
        </View>
      ))}
    </EliteCard>
  );
}

function TradeCard({ item, ownerByTeam }: { item: TradeItem; ownerByTeam: Map<number, number> }) {
  const sides = [
    { id: item.proposing_owner_id, name: item.proposing_owner_name },
    { id: item.receiving_owner_id, name: item.receiving_owner_name },
  ];
  const known = item.assets.every((a) => ownerByTeam.has(a.to_team_id));
  return (
    <EliteCard style={[styles.wireCard, styles.tradeCard]}>
      <View style={styles.spread}>
        <Text style={[eliteText.kickerCaps, { color: Elite.peach }]}>TRADE</Text>
        <Text style={eliteText.small}>{relativeTime(item.timestamp)}</Text>
      </View>
      {known ? (
        <View style={styles.tradeSides}>
          {sides.map((s) => (
            <View key={s.id} style={styles.tradeSide}>
              <Text style={eliteText.name}>{s.name} gets</Text>
              <View style={styles.chipRow}>
                {item.assets
                  .filter((a) => ownerByTeam.get(a.to_team_id) === s.id)
                  .map((a) => (
                    <PlayerChip key={a.player_name} added name={a.player_name} plain />
                  ))}
              </View>
            </View>
          ))}
        </View>
      ) : (
        <>
          <Text style={eliteText.name}>
            {item.proposing_owner_name} <Text style={eliteText.small}>traded with</Text> {item.receiving_owner_name}
          </Text>
          <View style={styles.chipRow}>
            {item.assets.map((a) => (
              <PlayerChip key={a.player_name} added name={a.player_name} plain />
            ))}
          </View>
        </>
      )}
    </EliteCard>
  );
}

function PlayerChip({ name, added, plain }: { name: string; added?: boolean; plain?: boolean }) {
  return (
    <View style={[styles.playerChip, added ? styles.addChip : styles.dropChip]}>
      <Text style={[styles.playerChipText, { color: added ? Elite.mint : Elite.peach }]}>
        {plain ? '' : added ? '+ ' : '− '}
        {name}
      </Text>
    </View>
  );
}

// What the commissioner has changed (2026-10-23, backend app/domain/
// commish_log.py), unless the commissioner made the log private.
function CommishChanges() {
  const [all, setAll] = useState(false);
  const q = useLeagueChanges();
  const changes = q.data?.public ? q.data.changes : [];
  if (changes.length === 0) return null;
  const shown = all ? changes : changes.slice(0, 5);
  return (
    <View style={styles.gap}>
      <EliteLabel>COMMISSIONER CHANGES</EliteLabel>
      <EliteCard>
        {shown.map((c, i) => (
          <View key={c.id} style={[styles.change, i > 0 && styles.divided]}>
            <Text style={styles.changeText}>{c.summary}</Text>
            <Text style={styles.changeMeta}>
              {c.actor_name} · {new Date(c.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </Text>
          </View>
        ))}
      </EliteCard>
      {changes.length > 5 && !all ? (
        <Pressable onPress={() => setAll(true)} style={({ pressed }) => [styles.loadMore, pressed && { opacity: 0.6 }]} accessibilityRole="button">
          <Text style={styles.loadMoreText}>Show all {changes.length}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: Spacing.lg },
  gapSm: { gap: Spacing.sm },
  flex: { flex: 1 },
  flexShrink: { flexShrink: 1 },
  center: { alignItems: 'center', textAlign: 'center' },
  spread: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.08)' },
  pressed: { backgroundColor: 'rgba(255,255,255,0.05)' },
  disabled: { opacity: 0.25 },
  dim: { color: 'rgba(245,244,236,0.75)' },
  alignEnd: { alignItems: 'flex-end' },
  nameWithBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', flexShrink: 1 },
  tiles: { flexDirection: 'row', gap: 8 },
  body: { color: Colors.text, fontSize: 14 },
  smallMuted: { color: 'rgba(255,255,255,0.5)', fontSize: 12, lineHeight: 17 },
  // The Hive
  inviteRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  inviteButton: { minHeight: 38, justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: Elite.green, backgroundColor: 'rgba(57,255,20,0.08)', paddingHorizontal: 14 },
  inviteText: { color: Elite.green, fontSize: 13, fontWeight: '700' },
  hiveInitials: { fontFamily: ANTON, fontSize: 20, lineHeight: 24, color: Elite.cream },
  hiveRank: { fontSize: 10, fontWeight: '800' },
  yourTeam: { padding: 16, gap: 10 },
  yourTeamName: { fontFamily: ANTON, fontSize: 28, lineHeight: 34, color: Elite.cream },
  buttonRow: { flexDirection: 'row', gap: 8 },
  orangeButton: { flex: 1, minHeight: 44, borderRadius: 14, backgroundColor: Elite.orange, alignItems: 'center', justifyContent: 'center' },
  orangeButtonText: { color: '#1a0b00', fontSize: 14, fontWeight: '800' },
  ghostButton: { flex: 1, minHeight: 44, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  ghostButtonText: { color: Elite.cream, fontSize: 14, fontWeight: '700' },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: 14, paddingVertical: 10 },
  listMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  cellInitials: { fontSize: 12, fontWeight: '800', color: Elite.cream },
  listRank: { fontFamily: ANTON, fontSize: 20, lineHeight: 26, minWidth: 28, textAlign: 'right' },
  // Polls
  poll: { gap: Spacing.md },
  pollTitle: { color: Colors.text, fontSize: 14, fontWeight: '600' },
  pollOption: { backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, overflow: 'hidden' },
  pollFill: { position: 'absolute', top: 0, bottom: 0, left: 0, backgroundColor: 'rgba(255,255,255,0.05)' },
  pollLine: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.sm },
  // Standings
  seedRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 12 },
  mineRow: { backgroundColor: 'rgba(255,122,26,0.10)' },
  toiletRow: { backgroundColor: 'rgba(255,122,26,0.05)' },
  championRow: { backgroundColor: 'rgba(251,191,36,0.1)' },
  loserRow: { backgroundColor: 'rgba(139,90,43,0.1)' },
  seedText: { fontFamily: ANTON, fontSize: 18, lineHeight: 22 },
  record: { fontFamily: ANTON, fontSize: 20, lineHeight: 26, color: Elite.cream },
  pct: { width: 58, alignItems: 'flex-end', gap: 4 },
  pctText: { fontSize: 12, fontWeight: '800' },
  meter: { width: 58, height: 5, borderRadius: 3, backgroundColor: 'rgba(245,244,236,0.12)', overflow: 'hidden' },
  meterFill: { height: 5, borderRadius: 3 },
  pill: { alignSelf: 'flex-start', borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 2, marginTop: 4 },
  pillText: { fontSize: 12, fontWeight: '500' },
  cutoff: { height: 34, justifyContent: 'center', alignItems: 'center' },
  cutoffLine: { position: 'absolute', left: 0, right: 0, borderTopWidth: 2, shadowOpacity: 0.9, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } },
  cutoffPill: { borderRadius: 10, borderWidth: 1, backgroundColor: Elite.deep, paddingHorizontal: 12, paddingVertical: 3 },
  cutoffText: { fontSize: 11, fontWeight: '800', letterSpacing: 2 },
  // Scoreboard
  plateRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16 },
  plate: { paddingHorizontal: 22, paddingVertical: 8, alignItems: 'center', borderRadius: 14 },
  plateWeek: { fontFamily: ANTON, fontSize: 24, lineHeight: 30, letterSpacing: 3, color: Elite.peach, textShadowColor: 'rgba(255,122,26,0.8)', textShadowRadius: 10 },
  plateStatus: { fontSize: 11, fontWeight: '800', letterSpacing: 1.5 },
  plateArrow: { color: Elite.green, fontSize: 20, fontWeight: '700' },
  scoreCard: { paddingVertical: 6 },
  scoreKicker: { paddingHorizontal: 14, paddingTop: 8 },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: 14, paddingVertical: 10 },
  scoreValue: { fontFamily: ANTON, fontSize: 26, lineHeight: 32, letterSpacing: 1, color: Elite.cream },
  scoreLead: { color: Elite.green, textShadowColor: 'rgba(57,255,20,0.6)', textShadowRadius: 10 },
  scoreOdds: { paddingHorizontal: 14, paddingBottom: 10 },
  // Power Rankings
  throne: { padding: 16, gap: 14 },
  throneTop: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  throneRank: { fontFamily: ANTON, fontSize: 44, lineHeight: 52, color: '#2a1102' },
  throneName: { fontFamily: ANTON, fontSize: 26, lineHeight: 31, color: Elite.cream },
  powerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  powerRankText: { fontFamily: ANTON, fontSize: 20, lineHeight: 24 },
  powerNote: { color: Elite.peach, fontSize: 12, marginTop: 2 },
  powerStats: { color: Elite.faint, fontSize: 11, marginTop: 5 },
  powerStatValue: { color: Elite.cream, fontWeight: '700' },
  flat: { color: 'rgba(255,255,255,0.3)', fontSize: 12, width: 34, textAlign: 'right' },
  movement: { fontSize: 13, fontWeight: '800', width: 34, textAlign: 'right', fontVariant: ['tabular-nums'] },
  climb: { paddingVertical: 12, paddingHorizontal: 0, gap: 8 },
  climbHead: { paddingHorizontal: 16 },
  legend: { gap: 6, paddingHorizontal: 12 },
  legendChip: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', backgroundColor: Elite.cell },
  legendSwatch: { width: 14, borderTopWidth: 3 },
  teamChip: { minHeight: 32, justifyContent: 'center', paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', backgroundColor: Elite.cell },
  teamChipOn: { backgroundColor: Elite.cream, borderColor: Elite.cream },
  teamChipText: { color: Elite.cream, fontSize: 12, fontWeight: '600' },
  moveCard: { flex: 1, padding: 12, gap: 4 },
  moveValue: { fontFamily: ANTON, fontSize: 20, lineHeight: 26, color: Elite.cream },
  // Rivalries
  rivalry: { padding: 16, gap: 12 },
  heatRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  heatBar: { width: 16, height: 6, borderRadius: 3, backgroundColor: 'rgba(245,244,236,0.15)' },
  heatOn: { backgroundColor: Elite.orange },
  rivalryName: { fontFamily: ANTON, fontSize: 22, lineHeight: 28, color: Elite.cream },
  rivalryNameMain: { fontSize: 28, lineHeight: 34, textAlign: 'center' },
  tagline: { fontFamily: SATISFY, fontSize: 18, lineHeight: 24, color: '#ffd0a0' },
  fight: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  fighter: { width: 100, alignItems: 'center', gap: 6 },
  fighterInitials: { fontFamily: ANTON, fontSize: 20, lineHeight: 24 },
  fighterName: { color: Elite.cream, fontSize: 13, fontWeight: '700', textAlign: 'center' },
  series: { fontFamily: ANTON, fontSize: 38, lineHeight: 44, letterSpacing: 2, color: Elite.cream },
  seriesMain: { fontSize: 44, lineHeight: 52, color: Elite.peach, textShadowColor: 'rgba(255,122,26,0.7)', textShadowRadius: 12 },
  // History
  tile: { gap: 4 },
  pressedTile: { opacity: 0.8 },
  tileTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tileDot: { width: 6, height: 6, borderRadius: 3, shadowOpacity: 0.9, shadowRadius: 4, shadowOffset: { width: 0, height: 0 } },
  tileTitle: { color: Colors.text, fontSize: 15, fontWeight: '500' },
  // The Wire
  filterChip: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(57,255,20,0.28)', backgroundColor: Elite.cell },
  filterChipOn: { backgroundColor: Elite.green, borderColor: Elite.green },
  filterText: { color: 'rgba(245,244,236,0.8)', fontSize: 13, fontWeight: '700' },
  wire: { gap: Spacing.md },
  rail: { position: 'absolute', left: 9, top: 0, bottom: 0, width: 2, backgroundColor: 'rgba(57,255,20,0.35)' },
  dayLabel: { paddingLeft: 32 },
  event: { flexDirection: 'row', alignItems: 'flex-start' },
  node: { width: 32, paddingTop: 16, paddingLeft: 2 },
  wireCard: { flex: 1, padding: 12, gap: 8, borderRadius: 18 },
  wireCardMine: { borderColor: 'rgba(255,122,26,0.4)' },
  tradeCard: { borderColor: 'rgba(255,122,26,0.5)', backgroundColor: '#1a1610' },
  tradeSides: { flexDirection: 'row', gap: 10 },
  tradeSide: { flex: 1, gap: 6 },
  sourceTag: { color: Elite.faint, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  playerChip: { minHeight: 30, justifyContent: 'center', paddingHorizontal: 10, borderRadius: 10 },
  addChip: { backgroundColor: 'rgba(57,255,20,0.12)' },
  dropChip: { backgroundColor: 'rgba(255,122,26,0.12)' },
  playerChipText: { fontSize: 13, fontWeight: '600' },
  change: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, gap: 2 },
  changeText: { color: Colors.text, fontSize: 14, fontWeight: '600', lineHeight: 20 },
  changeMeta: { color: Colors.textSecondary, fontSize: 12 },
  loadMore: { alignSelf: 'center', minHeight: 40, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', justifyContent: 'center' },
  loadMoreText: { color: 'rgba(255,255,255,0.75)', fontSize: 14, fontWeight: '600' },
});
