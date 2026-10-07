import { router } from 'expo-router';
import { Fragment, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';

import { BracketExperience } from '@/components/bracket/BracketExperience';
import { PreviewLink } from '@/components/PreviewLink';
import { ActivityRow } from '@/components/home/FeedCards';
import { RankBadge } from '@/components/home/YourWeekCard';
import {
  leagueStyles as ls,
  ListPanel,
  Muted,
  openOwner,
  PageTitle,
  RankedCategoryCard,
  Segmented,
} from '@/components/league/LeagueUI';
import { NeonPanel } from '@/components/NeonPanel';
import { Text } from '@/components/Text';
import { LoadingState, TeamAvatar } from '@/components/ui';
import { Colors, Fonts, Radius, SectionColors, Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { useAppearance } from '@/lib/appearance';
import {
  queryClient,
  useAllTimePowerRankings,
  useHouseRules,
  useLatestPowerRankings,
  useLeagueActivity,
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
import type { MatchupContextSide, Poll, StandingsRow, WeekMatchupContextItem } from '@/lib/types';

const ACTIVITY_COLOR = '#64748b';
const MAX_WEEK = 17;

// ---- League (overview) ----

export function LeagueOverview({ season }: { season: number | null }) {
  const me = useMe().data;
  const teams = useSeasonTeams(season).data ?? [];
  const rankings = useLatestPowerRankings(season).data?.rankings ?? [];
  const rankByTeam = new Map(rankings.map((r) => [r.team_id, r.power_rank]));
  return (
    <View style={styles.gap}>
      <View style={styles.titleRow}>
        <PageTitle>League</PageTitle>
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
      <ListPanel color={SectionColors.league}>
        {teams.map((t, i) => (
          <View key={t.team_id} style={[ls.row, i > 0 && ls.divided]}>
            <PreviewLink
              href={{ pathname: '/team/[id]', params: { id: String(t.team_id) } }}
              menu={[{ title: 'Owner Profile', icon: 'person.crop.circle', onPress: () => openOwner(t.owner_id) }]}
              style={styles.nameWithBadge}>
              <Text style={ls.name}>{t.team_name}</Text>
              <RankBadge rank={rankByTeam.get(t.team_id)} />
            </PreviewLink>
            <Pressable onPress={() => openOwner(t.owner_id)}>
              <Text style={styles.ownerRight}>{t.owner_name}</Text>
            </Pressable>
          </View>
        ))}
      </ListPanel>
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
      <PageTitle>Standings</PageTitle>
      <Segmented options={options} value={view} onChange={setView} />
      {view === 'standings' && <StandingsTable season={season} data={standingsQ.data} loading={standingsQ.isPending} />}
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
  const accent = useAppearance().accent;
  const me = useMe().data;
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

  return (
    <View style={styles.gapSm}>
      <Text style={styles.smallMuted}>
        {isFinal ? 'Final standings.' : 'Season in progress.'}
        {rankedByPoints && ' Ranked by total points.'}
        {showPlayoffLine && ` Top ${playoffCount} make the playoffs.`}
        {showToilet && ` The bottom ${toiletBowl} risk the Toilet Bowl.`}
        {odds && ' Playoff % comes from 10,000 simulated seasons.'}
      </Text>
      <ListPanel color={SectionColors.standings}>
        {standings.map((row, i) => {
          const champion = row.final_rank === 1;
          const loser = row.final_rank !== null && row.final_rank === standings.length;
          const games = row.wins + row.losses + row.ties;
          const pct = oddsByTeam.get(row.team_id);
          return (
            <Fragment key={row.team_id}>
              <View
                style={[
                  styles.standingsRow,
                  i > 0 && ls.divided,
                  champion && styles.championRow,
                  loser && styles.loserRow,
                ]}>
                <View style={styles.standingsTop}>
                  <Text style={ls.rank}>{i + 1}</Text>
                  <View style={ls.flex}>
                    <PreviewLink href={{ pathname: '/team/[id]', params: { id: String(row.team_id) } }} style={styles.nameWithBadge}>
                      <Text style={ls.name}>{row.team_name}</Text>
                      <RankBadge rank={rankByTeam.get(row.team_id)} />
                    </PreviewLink>
                    {row.eliminated_week != null && <Pill text={`🪓 Cut Wk ${row.eliminated_week}`} color="#f87171" bg="rgba(239,68,68,0.15)" />}
                    {champion && <Pill text="🏆 Champion" color="#fcd34d" bg="rgba(251,191,36,0.2)" />}
                    {loser && <Pill text="💩 League Loser" color="#d9b98a" bg="rgba(139,90,43,0.3)" />}
                    <Text style={ls.owner}>{row.owner_name}</Text>
                  </View>
                </View>
                <View style={styles.standingsStats}>
                  <Text style={styles.record}>
                    {row.wins}-{row.losses}-{row.ties}
                  </Text>
                  <Text style={ls.value}>PPG {games ? (Number(row.points_for) / games).toFixed(1) : '—'}</Text>
                  <Text style={ls.value}>PF {Number(row.points_for).toFixed(1)}</Text>
                  <Text style={ls.value}>PA {Number(row.points_against).toFixed(1)}</Text>
                  {pct !== undefined && (
                    <Text style={[styles.oddsPct, pct >= 75 ? styles.oddsHigh : pct <= 10 ? styles.oddsLow : null]}>
                      {pct > 0 && pct < 1 ? '<1' : Math.round(pct)}% playoffs
                    </Text>
                  )}
                </View>
              </View>
              {showPlayoffLine && i + 1 === playoffCount && <Divider label={`Playoff line — top ${playoffCount}`} color={accent} dark />}
              {showToilet && i + 1 === standings.length - toiletBowl && (
                <Divider label={`🚽 Toilet bowl — bottom ${toiletBowl}`} color="#d97706" />
              )}
            </Fragment>
          );
        })}
      </ListPanel>
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

// The dashed playoff / toilet-bowl cutoff line with its label.
function Divider({ label, color, dark }: { label: string; color: string; dark?: boolean }) {
  return (
    <View style={styles.cutoff}>
      <View style={[styles.cutoffLine, { borderColor: color }]} />
      <View style={[styles.cutoffPill, { backgroundColor: color }]}>
        <Text style={[styles.cutoffText, { color: dark ? '#06110a' : '#fff' }]}>{label}</Text>
      </View>
    </View>
  );
}

const STREAK_ICON: Record<string, string> = { hot: '🔥', cold: '🥶', neutral: '' };

// The web's WeekScoreboardBrowser + WeekScoreboardList.
function WeekScoreboard({ season }: { season: number }) {
  const currentWeek = useSeasonWeek().data?.week ?? 1;
  const [week, setWeek] = useState<number | null>(null);
  const shown = week ?? currentWeek;
  const context = useMatchupContext(season, shown);
  const matchups = context.data?.matchups ?? [];

  return (
    <View style={styles.gap}>
      <View style={styles.weekStepper}>
        <Pressable disabled={shown <= 1} onPress={() => setWeek(shown - 1)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Previous week" accessibilityState={{ disabled: shown <= 1 }}>
          <Text style={[styles.arrow, shown <= 1 && styles.disabled]}>‹</Text>
        </Pressable>
        <Text style={styles.weekLabel}>Week {shown}</Text>
        <Pressable disabled={shown >= MAX_WEEK} onPress={() => setWeek(shown + 1)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Next week" accessibilityState={{ disabled: shown >= MAX_WEEK }}>
          <Text style={[styles.arrow, shown >= MAX_WEEK && styles.disabled]}>›</Text>
        </Pressable>
      </View>
      {context.isPending ? (
        <LoadingState />
      ) : matchups.length === 0 ? (
        <Muted>No matchups for this week.</Muted>
      ) : (
        matchups.map((m) => <ScoreboardCard key={m.matchup_id} matchup={m} />)
      )}
    </View>
  );
}

function ScoreboardCard({ matchup }: { matchup: WeekMatchupContextItem }) {
  const open = () => router.push({ pathname: '/matchup/[id]', params: { id: String(matchup.matchup_id) } });
  return (
    <NeonPanel radius={Radius.md} contentStyle={styles.scoreCard}>
      <ScoreRow side={matchup.home} opponent={matchup.away} onPress={open} />
      <View style={styles.vsRow}>
        <View style={styles.vsLine} />
        <Text style={styles.vs}>VS</Text>
        <View style={styles.vsLine} />
      </View>
      <ScoreRow side={matchup.away} opponent={matchup.home} onPress={open} />
    </NeonPanel>
  );
}

function ScoreRow({ side, opponent, onPress }: { side: MatchupContextSide; opponent: MatchupContextSide; onPress: () => void }) {
  const leading = side.score !== null && opponent.score !== null && side.score > opponent.score;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.scoreRow, pressed && ls.pressed]}>
      <TeamAvatar name={side.owner_name ?? side.team_name} logoUrl={side.logo_url} size={36} />
      <View style={ls.flex}>
        <View style={styles.nameWithBadge}>
          <Text style={[styles.scoreName, !leading && styles.dim]}>
            {side.team_name}
            {STREAK_ICON[side.streak] ? ` ${STREAK_ICON[side.streak]}` : ''}
          </Text>
          <RankBadge rank={side.power_rank} />
        </View>
        <Text style={ls.owner}>
          {side.owner_name}
          {side.record ? ` · ${side.record}` : ''}
        </Text>
      </View>
      <View style={styles.alignEnd}>
        <Text style={[styles.scoreValue, !leading && styles.dim]}>{side.score !== null ? side.score.toFixed(1) : '—'}</Text>
        {side.projected_total !== null && <Text style={styles.smallMuted}>Proj {side.projected_total.toFixed(1)}</Text>}
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
      <PageTitle subtitle="Who's actually good: record, all-play record, scoring, recent form and margin. Luck is wins above what your scores earned; SoS ranks your schedule so far and what's ahead (1st = hardest).">
        Power Rankings
      </PageTitle>
      <Segmented
        options={[
          { key: 'week', label: 'This Week' },
          { key: 'trend', label: 'Season Trend' },
          { key: 'all-time', label: 'All-Time' },
        ]}
        value={view}
        onChange={setView}
      />
      {view === 'week' && <PowerWeek season={season} />}
      {view === 'trend' && <PowerTrend season={season} />}
      {view === 'all-time' && <PowerAllTime />}
    </View>
  );
}

function Movement({ movement }: { movement: number | null }) {
  if (movement === null || movement === 0) return <Text style={styles.flat}>—</Text>;
  const up = movement > 0;
  return (
    <Text style={[styles.movement, { color: up ? '#10b981' : '#ef4444' }]}>
      {up ? '▲' : '▼'} {Math.abs(movement)}
    </Text>
  );
}

// 1st, 2nd, 11th — schedule-strength ranks (1st = hardest).
function rankLabel(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

function PowerWeek({ season }: { season: number | null }) {
  const q = useWeekPowerRankings(season);
  if (q.isPending) return <LoadingState />;
  if (!q.data || q.data.week === null) {
    return <Muted>No power rankings computed for {season} yet — this fills in once a sync has run for at least one completed week.</Muted>;
  }
  return (
    <ListPanel color={SectionColors.powerRankings}>
      <View style={[ls.row, styles.powerHead]}>
        <Text style={styles.headText}>Week {q.data.week}</Text>
        <View style={styles.powerCols}>
          <Text style={[styles.headText, styles.col]}>Luck</Text>
          <Text style={[styles.headText, styles.col]}>SoS</Text>
          <Text style={[styles.headText, styles.col]}>Ahead</Text>
          <Text style={[styles.headText, styles.col]}>Trend</Text>
        </View>
      </View>
      {q.data.rankings.map((r) => (
        <View key={r.team_id} style={[ls.row, ls.divided]}>
          <View style={styles.powerTeam}>
            <Text style={styles.powerRank}>{r.power_rank}</Text>
            <View style={ls.flex}>
              <Text style={ls.name}>{r.team_name}</Text>
              <Text style={ls.owner}>
                {r.owner_name}
                {r.record ? ` · ${r.record}` : ''}
              </Text>
              {r.note && <Text style={styles.powerNote}>{r.note}</Text>}
            </View>
          </View>
          <View style={styles.powerCols}>
            <Text style={[styles.colValue, styles.col]}>{r.luck_wins !== undefined ? `${r.luck_wins > 0 ? '+' : ''}${r.luck_wins.toFixed(1)}` : '—'}</Text>
            <Text style={[styles.colValue, styles.col]}>{r.sos_rank ? rankLabel(r.sos_rank) : '—'}</Text>
            <Text style={[styles.colValue, styles.col]}>{r.sos_remaining_rank ? rankLabel(r.sos_remaining_rank) : '—'}</Text>
            <View style={styles.col}>
              <Movement movement={r.movement} />
            </View>
          </View>
        </View>
      ))}
    </ListPanel>
  );
}

// Each team's weekly rank as a sparkline (the web's beta trend view,
// which reads better on a phone than its wide table), latest rank last.
function PowerTrend({ season }: { season: number | null }) {
  const accent = useAppearance().accent;
  const q = usePowerRankingsTrend(season);
  if (q.isPending) return <LoadingState />;
  const teams = q.data ?? [];
  if (teams.length === 0) return <Muted>No power rankings computed for {season} yet.</Muted>;
  const weeks = Array.from(new Set(teams.flatMap((t) => t.weeks.map((w) => w.week)))).sort((a, b) => a - b);
  const count = teams.length;
  return (
    <ListPanel color={SectionColors.powerRankings}>
      {teams.map((t, i) => {
        const points = weeks.map((w) => t.weeks.find((x) => x.week === w)?.power_rank ?? null).filter((r): r is number => r !== null);
        const latest = points[points.length - 1] ?? null;
        const coords = points
          .map((rank, idx) => {
            const x = points.length > 1 ? (idx / (points.length - 1)) * 100 : 50;
            const y = count > 1 ? ((rank - 1) / (count - 1)) * 24 + 3 : 15;
            return `${x},${y}`;
          })
          .join(' ');
        return (
          <View key={t.team_id} style={[ls.row, i > 0 && ls.divided]}>
            <View style={ls.flex}>
              <Text style={ls.name}>{t.team_name}</Text>
              <Text style={ls.owner}>{t.owner_name}</Text>
            </View>
            {points.length > 1 && (
              <Svg width={80} height={24} viewBox="0 0 100 30" preserveAspectRatio="none">
                <Polyline points={coords} fill="none" stroke={accent} strokeWidth={2} />
              </Svg>
            )}
            <Text style={styles.trendRank}>{latest ?? '—'}</Text>
          </View>
        );
      })}
    </ListPanel>
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
        <RankedCategoryCard
          key={c.key}
          emoji={c.emoji}
          label={c.label}
          color={SectionColors.powerRankings}
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

// ---- Rivalries ----

export function RivalriesSection() {
  const q = useRivalries();
  const rivalries = q.data ?? [];
  return (
    <View style={styles.gap}>
      <PageTitle>Rivalries</PageTitle>
      {q.isPending ? (
        <LoadingState />
      ) : rivalries.length === 0 ? (
        <Muted>No rivalries recorded.</Muted>
      ) : (
        rivalries.map((r) => (
          <NeonPanel key={r.id} color={SectionColors.rivalries} contentStyle={styles.rivalry}>
            <View style={styles.rivalryHead}>
              <Text style={styles.rivalryName}>
                {r.emoji ? `${r.emoji} ` : ''}
                {r.name ?? `${r.owner_a_name} vs ${r.owner_b_name}`}
              </Text>
              {r.tier && (
                <View style={styles.tier}>
                  <Text style={styles.tierText}>{r.tier}</Text>
                </View>
              )}
            </View>
            {r.tagline && <Text style={styles.tagline}>{r.tagline}</Text>}
            {r.description && <Text style={styles.description}>{r.description}</Text>}
            <View style={styles.rivalryScore}>
              <Pressable onPress={() => openOwner(r.owner_a_id)}>
                <Text style={styles.body}>{r.owner_a_name}</Text>
              </Pressable>
              <Text style={styles.smallMuted}>
                {r.all_time_wins_a}-{r.all_time_wins_b}
              </Text>
              <Pressable onPress={() => openOwner(r.owner_b_id)}>
                <Text style={styles.body}>{r.owner_b_name}</Text>
              </Pressable>
            </View>
          </NeonPanel>
        ))
      )}
    </View>
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

// ---- Activity ----

export function ActivitySection({ season }: { season: number | null }) {
  const q = useLeagueActivity(season, 50);
  const items = q.data ?? [];
  return (
    <View style={styles.gap}>
      <PageTitle subtitle="Trades, waiver pickups, and free-agent adds and drops.">
        League Activity
      </PageTitle>
      {q.isPending ? (
        <LoadingState />
      ) : items.length === 0 ? (
        <Muted>No activity yet.</Muted>
      ) : (
        <ListPanel color={ACTIVITY_COLOR}>
          {items.map((item, i) => (
            <ActivityRow key={`${item.kind}-${item.timestamp}-${i}`} item={item} divided={i > 0} />
          ))}
        </ListPanel>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  inviteButton: { borderRadius: Radius.pill, borderWidth: 1, borderColor: 'rgba(57,255,20,0.5)', backgroundColor: 'rgba(57,255,20,0.08)', paddingHorizontal: 12, paddingVertical: 6 },
  inviteText: { color: Colors.accent, fontSize: 13, fontWeight: '700' },
  gap: { gap: Spacing.lg },
  gapSm: { gap: Spacing.sm },
  body: { color: Colors.text, fontSize: 14 },
  bold: { fontWeight: '700' },
  dim: { color: 'rgba(255,255,255,0.7)' },
  smallMuted: { color: 'rgba(255,255,255,0.5)', fontSize: 12, lineHeight: 17 },
  nameWithBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', flexShrink: 1 },
  ownerRight: { color: 'rgba(255,255,255,0.6)', fontSize: 14 },
  alignEnd: { alignItems: 'flex-end' },
  poll: { gap: Spacing.md },
  pollTitle: { color: Colors.text, fontSize: 14, fontWeight: '600' },
  pollOption: { backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    overflow: 'hidden',
  },
  pollFill: { position: 'absolute', top: 0, bottom: 0, left: 0, backgroundColor: 'rgba(255,255,255,0.05)' },
  pollLine: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.sm },
  standingsRow: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, gap: 6 },
  championRow: { backgroundColor: 'rgba(251,191,36,0.1)' },
  loserRow: { backgroundColor: 'rgba(139,90,43,0.1)' },
  standingsTop: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  standingsStats: { flexDirection: 'row', gap: Spacing.lg, paddingLeft: 32 },
  record: { color: Colors.text, fontSize: 14, fontWeight: '500', fontVariant: ['tabular-nums'] },
  pill: { alignSelf: 'flex-start', borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 2, marginTop: 4 },
  pillText: { fontSize: 12, fontWeight: '500' },
  cutoff: { height: 24, justifyContent: 'center', alignItems: 'center' },
  cutoffLine: { position: 'absolute', left: 0, right: 0, borderTopWidth: 2, borderStyle: 'dashed' },
  cutoffPill: { borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  cutoffText: { fontSize: 10, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase' },
  weekStepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.lg },
  arrow: { color: 'rgba(255,255,255,0.6)', fontSize: 24 },
  disabled: { opacity: 0.2 },
  weekLabel: { width: 90, textAlign: 'center', color: Colors.text, fontSize: 14, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase' },
  scoreCard: { padding: 0 },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md },
  scoreName: { color: Colors.text, fontSize: 14, fontWeight: '600' },
  scoreValue: { fontFamily: Fonts.monoBold, color: Colors.text, fontSize: 18, fontVariant: ['tabular-nums'] },
  vsRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.md, paddingLeft: 60 },
  vsLine: { flex: 1, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)' },
  vs: { color: 'rgba(255,255,255,0.3)', fontSize: 10, fontWeight: '600', letterSpacing: 0.8 },
  bracket: { gap: Spacing.lg },
  oddsPct: { fontSize: 12, fontWeight: '700', color: Colors.text },
  oddsHigh: { color: '#39ff14' },
  oddsLow: { color: '#d9a066' },
  bracketCta: { padding: Spacing.md, borderRadius: 16, borderWidth: 1, borderColor: '#f5c542', backgroundColor: 'rgba(245,197,66,0.08)', gap: 4 },
  bracketCtaTitle: { fontFamily: Fonts.displayBold, fontSize: 18, letterSpacing: 1, color: '#f5c542' },
  bracketCtaSub: { fontSize: 13, color: 'rgba(255,255,255,0.7)' },
  bracketRound: { width: 200, gap: Spacing.sm },
  roundLabel: { color: 'rgba(255,255,255,0.4)', fontSize: 11, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase' },
  bracketNodes: { flex: 1, justifyContent: 'space-around', gap: Spacing.md },
  bracketNode: { borderRadius: Radius.md, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  bracketTeam: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  bracketName: { color: 'rgba(255,255,255,0.8)', fontSize: 14, flexShrink: 1 },
  seed: { width: 16, color: 'rgba(255,255,255,0.4)', fontSize: 12 },
  check: { color: '#10b981' },
  projected: { borderRadius: Radius.md, borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.15)' },
  flat: { color: 'rgba(255,255,255,0.3)', fontSize: 12 },
  movement: { fontSize: 12, fontVariant: ['tabular-nums'] },
  powerHead: { paddingVertical: Spacing.sm },
  headText: { color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: '600', textTransform: 'uppercase' },
  powerCols: { flexDirection: 'row', gap: Spacing.sm },
  col: { width: 38, textAlign: 'right', alignItems: 'flex-end' },
  powerNote: { color: '#fbbf24', fontSize: 11, marginTop: 1 },
  colValue: { color: 'rgba(255,255,255,0.6)', fontSize: 12, fontVariant: ['tabular-nums'] },
  powerTeam: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, flex: 1 },
  powerRank: { width: 24, textAlign: 'center', color: Colors.text, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  trendRank: { width: 32, textAlign: 'right', color: Colors.text, fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  rivalry: { gap: Spacing.sm },
  rivalryHead: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  rivalryName: { color: Colors.text, fontSize: 16, fontWeight: '500', flexShrink: 1 },
  tier: { backgroundColor: Colors.surface, borderRadius: Radius.pill, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 8, paddingVertical: 2 },
  tierText: { color: 'rgba(255,255,255,0.6)', fontSize: 12 },
  tagline: { color: 'rgba(255,255,255,0.6)', fontSize: 14, fontStyle: 'italic' },
  description: { color: 'rgba(255,255,255,0.7)', fontSize: 14, lineHeight: 20 },
  rivalryScore: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: Spacing.sm },
  tile: { gap: 4 },
  pressedTile: { opacity: 0.8 },
  tileTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tileDot: { width: 6, height: 6, borderRadius: 3, shadowOpacity: 0.9, shadowRadius: 4, shadowOffset: { width: 0, height: 0 } },
  tileTitle: { color: Colors.text, fontSize: 15, fontWeight: '500' },
});
