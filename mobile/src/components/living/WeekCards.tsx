import { router, type Href } from 'expo-router';
import { StyleSheet, Text as RNText, View } from 'react-native';

import { Chip, Kicker, LinkText, Panel, Row } from '@/components/living/LivingCards';
import { Display, Text } from '@/components/Text';
import { Colors, Spacing } from '@/constants/theme';
import { encodeScenario } from '@/lib/bracketEngine';
import { fmt, isStarter, untilText } from '@/lib/livingHome';
import type {
  FreeAgent,
  KeeperRules,
  MatchupContextSide,
  PlayoffOdds,
  PowerRankTrendTeam,
  RosterEntry,
  RosterPlayer,
  StandingsRow,
  TradeSettings,
  Trade,
  WeekMatchupContextItem,
  YourWeekMatchup,
} from '@/lib/types';

const UP = '#39ff14';

function openLeague(section: string, view?: string) {
  router.navigate({ pathname: '/league', params: { section, ...(view ? { view } : {}) } } as unknown as Href);
}
const DOWN = '#ff8a3d';

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

function rankOf(rows: { team_id: number; wins: number; points_for: number }[], teamId: number): number {
  const sorted = [...rows].sort((a, b) => b.wins - a.wins || b.points_for - a.points_for);
  return sorted.findIndex((r) => r.team_id === teamId) + 1;
}

// Where this week's result moved you in the standings, worked out by
// taking this week back out of the table.
export function StandingsMoveCard({
  standings,
  matchups,
  teamId,
  week,
  playoffSpots = 4,
}: {
  standings: StandingsRow[];
  matchups: WeekMatchupContextItem[];
  teamId: number;
  week: number;
  playoffSpots?: number;
}) {
  const after = standings.map((r) => ({ team_id: r.team_id, wins: r.wins + r.ties / 2, points_for: Number(r.points_for) }));
  const mineRow = standings.find((r) => r.team_id === teamId);
  if (!mineRow || mineRow.wins + mineRow.losses + mineRow.ties < week) return null;
  const before = after.map((r) => ({ ...r }));
  for (const m of matchups) {
    const h = m.home.score ?? 0;
    const a = m.away.score ?? 0;
    const home = before.find((r) => r.team_id === m.home.team_id);
    const away = before.find((r) => r.team_id === m.away.team_id);
    if (!home || !away) continue;
    home.points_for -= h;
    away.points_for -= a;
    if (h > a) home.wins -= 1;
    else if (a > h) away.wins -= 1;
    else {
      home.wins -= 0.5;
      away.wins -= 0.5;
    }
  }
  const was = rankOf(before, teamId);
  const now = rankOf(after, teamId);
  const sorted = [...after].sort((x, y) => y.wins - x.wins || y.points_for - x.points_for);
  const cut = sorted[playoffSpots];
  const mine = after.find((r) => r.team_id === teamId)!;
  const cushion = cut ? mine.wins - cut.wins : null;
  const moved = was - now;
  return (
    <Panel onPress={() => openLeague('standings')} label="Open the standings">
      <Kicker>What it did to the standings</Kicker>
      <View style={styles.bigRow}>
        <Display style={styles.big}>{ordinal(was)}</Display>
        <Text style={styles.arrow}>→</Text>
        <Display style={[styles.big, { color: moved > 0 ? UP : moved < 0 ? DOWN : Colors.text }]}>{ordinal(now)}</Display>
        <Chip color={moved > 0 ? UP : moved < 0 ? DOWN : Colors.textSecondary}>
          {moved > 0 ? `Up ${moved}` : moved < 0 ? `Down ${-moved}` : 'Held'}
        </Chip>
      </View>
      {cushion !== null && now <= playoffSpots && (
        <Text style={styles.muted}>
          {cushion >= 1 ? `${cushion} game${cushion === 1 ? '' : 's'} clear of ${ordinal(playoffSpots + 1)}` : `Level with ${ordinal(playoffSpots + 1)} on wins`}
        </Text>
      )}
      {now > playoffSpots && cut && (
        <Text style={styles.muted}>
          {(sorted[playoffSpots - 1].wins - mine.wins).toFixed(0)} game(s) back of the last playoff spot
        </Text>
      )}
    </Panel>
  );
}

// "You beat your projection by 12.4", this week's points rank, your
// biggest overachiever and biggest dud.
export function ProjectionReportCard({ me, matchups }: { me: MatchupContextSide; matchups: WeekMatchupContextItem[] }) {
  const score = me.score ?? 0;
  const projected = me.pregame_projected_total;
  const scores = matchups.flatMap((m) => [m.home.score ?? 0, m.away.score ?? 0]).sort((a, b) => b - a);
  const rank = scores.indexOf(score) + 1;
  const starters = me.roster.filter((p) => isStarter(p.lineup_slot) && p.points_projected != null && p.points_scored != null);
  const diff = (p: RosterPlayer) => (p.points_scored ?? 0) - (p.points_projected ?? 0);
  const best = [...starters].sort((a, b) => diff(b) - diff(a))[0];
  const worst = [...starters].sort((a, b) => diff(a) - diff(b))[0];
  return (
    <Panel>
      <Kicker>Report card</Kicker>
      {projected != null && (
        <Row
          first
          left="Vs. your projection"
          right={
            <Text style={[styles.right, { color: score >= projected ? UP : DOWN }]}>
              {score >= projected ? '+' : '−'}
              {Math.abs(score - projected).toFixed(1)}
            </Text>
          }
        />
      )}
      {rank > 0 && <Row first={projected == null} left="Points this week" right={`${ordinal(rank)} of ${scores.length}`} />}
      {best && diff(best) > 0 && <Row left="Overachiever" right={`${best.player_name} +${diff(best).toFixed(1)}`} />}
      {worst && diff(worst) < 0 && <Row left="Dud" right={`${worst.player_name} ${diff(worst).toFixed(1)}`} />}
    </Panel>
  );
}

// Every matchup's score, with upsets and blowouts called out.
export function LeagueScoreboardCard({
  matchups,
  teamId,
  title,
  live,
}: {
  matchups: WeekMatchupContextItem[];
  teamId: number;
  title: string;
  live?: boolean;
}) {
  const rows = matchups.filter((m) => m.home.team_id !== teamId && m.away.team_id !== teamId);
  if (rows.length === 0) return null;
  const closest = live
    ? [...rows].sort((a, b) => Math.abs((a.home.score ?? 0) - (a.away.score ?? 0)) - Math.abs((b.home.score ?? 0) - (b.away.score ?? 0)))[0]
    : null;
  return (
    <Panel>
      <Kicker>{title}</Kicker>
      {rows.map((m, i) => {
        const h = m.home.score ?? 0;
        const a = m.away.score ?? 0;
        const [win, lose] = h >= a ? [m.home, m.away] : [m.away, m.home];
        const margin = Math.abs(h - a);
        const upset = !live && win.power_rank != null && lose.power_rank != null && win.power_rank - lose.power_rank >= 3;
        const tag = upset ? 'Upset' : !live && margin >= 40 ? 'Blowout' : closest === m ? 'Closest' : null;
        return (
          <Row
            key={m.matchup_id}
            first={i === 0}
            left={
              <Text style={styles.rowText} numberOfLines={1}>
                {win.owner_name} {fmt(win.score)} – {fmt(lose.score)} {lose.owner_name}
              </Text>
            }
            right={tag ? <Chip color={tag === 'Upset' ? '#f5b942' : tag === 'Closest' ? '#4cc3ff' : DOWN}>{tag}</Chip> : ''}
          />
        );
      })}
    </Panel>
  );
}

// A rivalry game's updated all-time series.
export function RivalryResultCard({ item, teamId }: { item: WeekMatchupContextItem; teamId: number }) {
  if (!item.is_rivalry || !item.rivalry) return null;
  const meHome = item.home.team_id === teamId;
  const mine = meHome ? item.rivalry.all_time_wins_home : item.rivalry.all_time_wins_away;
  const theirs = meHome ? item.rivalry.all_time_wins_away : item.rivalry.all_time_wins_home;
  return (
    <Panel tint="#f5b942">
      <Kicker color="#f5b942">
        {item.rivalry.emoji ? `${item.rivalry.emoji} ` : ''}
        {item.rivalry.name}
      </Kicker>
      <Text style={styles.body}>
        All-time series now {mine}–{theirs}
        {mine > theirs ? ', your way' : mine < theirs ? ', their way' : ', all square'}
      </Text>
    </Panel>
  );
}

// Your power ranking now and how far it moved.
export function PowerMoveCard({ trend, teamId }: { trend: PowerRankTrendTeam[]; teamId: number }) {
  const mine = trend.find((t) => t.team_id === teamId);
  const weeks = mine?.weeks ?? [];
  if (weeks.length === 0) return null;
  const now = weeks[weeks.length - 1];
  const prev = weeks.length > 1 ? weeks[weeks.length - 2] : null;
  const moved = prev ? prev.power_rank - now.power_rank : 0;
  return (
    <Panel onPress={() => openLeague('powerRankings')} label="Open power rankings">
      <Kicker>Power rankings</Kicker>
      <View style={styles.bigRow}>
        <Display style={styles.big}>#{now.power_rank}</Display>
        {prev && (
          <Chip color={moved > 0 ? UP : moved < 0 ? DOWN : Colors.textSecondary}>
            {moved > 0 ? `Up ${moved}` : moved < 0 ? `Down ${-moved}` : 'No change'}
          </Chip>
        )}
      </View>
      <View style={styles.spark} accessibilityLabel={`Power rank by week: ${weeks.map((w) => w.power_rank).join(', ')}`}>
        {weeks.map((w) => (
          <View key={w.week} style={styles.sparkCol}>
            <View style={[styles.sparkBar, { height: Math.max(4, 40 - (w.power_rank - 1) * 3), backgroundColor: w === now ? UP : Colors.tileRaised }]} />
            <RNText style={styles.sparkLabel}>{w.week}</RNText>
          </View>
        ))}
      </View>
    </Panel>
  );
}

// Your playoff chances and what this week's game is worth.
export function PlayoffOddsCard({ odds, teamId }: { odds: PlayoffOdds; teamId: number }) {
  const mine = odds.teams.find((t) => t.team_id === teamId);
  if (!mine) return null;
  const next = odds.focus?.team_id === teamId ? odds.focus.next_game : null;
  return (
    <Panel onPress={() => openLeague('standings', 'playoffs')} label="Open playoff odds">
      <Kicker>Playoff odds</Kicker>
      <View style={styles.bigRow}>
        <Display style={styles.big}>{Math.round(mine.playoff_pct)}%</Display>
        <Text style={styles.muted}>to make it · {Math.round(mine.title_pct)}% to win it all</Text>
      </View>
      {next && next.if_win_pct != null && next.if_loss_pct != null && (
        <Text style={styles.body}>
          Win this week → {Math.round(next.if_win_pct)}% · Lose → {Math.round(next.if_loss_pct)}%
        </Text>
      )}
    </Panel>
  );
}

// The What-If engine's read on this week: what your own game is worth,
// and the other games that move your playoff chances most, with who to
// root for. Opens the What-If lab with the week already played your way.
const WHAT_IF = '#c084fc';
const MATTERS = 0.5;

// Half the card at a time (2026-10-16): "odds" (Tuesday–Saturday) is
// your playoff chances and what this week's result does to them;
// "root" (Sunday–Monday) is the other games to root for this week.
export function WhatIfCard({
  odds,
  teamId,
  standings,
  half,
}: {
  odds: PlayoffOdds;
  teamId: number;
  standings: StandingsRow[];
  half: 'odds' | 'root';
}) {
  const mine = odds.teams.find((t) => t.team_id === teamId);
  const focus = odds.focus?.team_id === teamId ? odds.focus : null;
  if (!mine || !focus || focus.games_left === 0) return null;
  const name = (id: number) => standings.find((r) => r.team_id === id)?.team_name ?? 'TBD';
  const next = focus.next_game;
  const games = (focus.root_this_week ?? focus.root_for.filter((r) => r.week === next?.week)).filter((r) => r.swing >= MATTERS);
  const shown = games.slice(0, 4);
  const pct = (n: number) => `${Math.round(n)}%`;

  const picks: Record<number, number> = {};
  if (next) picks[next.matchup_id] = teamId;
  for (const r of games) picks[r.matchup_id] = r.root_for_team_id;
  const w = encodeScenario({ flips: [], picks, playoff: {} }, teamId);

  return (
    <Panel
      tint={WHAT_IF}
      onPress={() => router.navigate({ pathname: '/league', params: { section: 'standings', view: 'playoffs', w } } as unknown as Href)}
      label="Play out this week in What-If">
      <Kicker color={WHAT_IF}>{half === 'odds' ? 'What-If · Your playoff picture' : 'What-If · Root for this week'}</Kicker>
      {half === 'odds' ? (
        <>
          <View style={styles.bigRow}>
            <Display style={styles.big}>{pct(mine.playoff_pct)}</Display>
            <Text style={styles.muted}>to make the playoffs right now</Text>
          </View>
          {next && next.if_win_pct != null && next.if_loss_pct != null && (
            <View style={styles.stakes}>
              <View style={[styles.stake, { borderColor: `${UP}55` }]}>
                <Text style={styles.small}>Beat {name(next.opponent_team_id)}</Text>
                <Text style={[styles.stakeNum, { color: UP }]}>{pct(next.if_win_pct)}</Text>
              </View>
              <View style={[styles.stake, { borderColor: `${DOWN}55` }]}>
                <Text style={styles.small}>Lose</Text>
                <Text style={[styles.stakeNum, { color: DOWN }]}>{pct(next.if_loss_pct)}</Text>
              </View>
            </View>
          )}
        </>
      ) : shown.length === 0 ? (
        <Text style={styles.body}>No other game this week moves your odds much. It&apos;s all on your own matchup.</Text>
      ) : (
        shown.map((r, i) => (
          <Row
            key={r.matchup_id}
            first={i === 0}
            left={
              <View style={styles.gap2}>
                <Text style={styles.rowText} numberOfLines={1}>
                  <Text style={styles.rootName}>{name(r.root_for_team_id)}</Text>
                  <Text style={styles.small}> over {name(r.against_team_id)}</Text>
                </Text>
                <Text style={styles.small}>
                  {i === 0 ? 'Your biggest game outside your own · ' : ''}
                  {pct(r.pct_if_root)} if they win, {pct(r.pct_if_other)} if not
                </Text>
              </View>
            }
            right={<Chip color={i === 0 ? WHAT_IF : UP}>{`+${r.swing.toFixed(1)}%`}</Chip>}
          />
        ))
      )}
      <LinkText
        color={WHAT_IF}
        onPress={() => router.navigate({ pathname: '/league', params: { section: 'standings', view: 'playoffs', w } } as unknown as Href)}>
        Play out the week in What-If →
      </LinkText>
    </Panel>
  );
}

// This week's opponent: record, form, power rank and your history.
export function NextOpponentCard({ matchup, item, teamId }: { matchup: YourWeekMatchup; item: WeekMatchupContextItem | null; teamId: number }) {
  const h2h = item?.head_to_head;
  const meHome = item?.home.team_id === teamId;
  const myWins = h2h ? (meHome ? h2h.wins_home : h2h.wins_away) : 0;
  const theirWins = h2h ? (meHome ? h2h.wins_away : h2h.wins_home) : 0;
  return (
    <Panel onPress={() => router.push({ pathname: '/matchup/[id]', params: { id: String(matchup.matchup_id) } })} label="Open this week's matchup">
      <Kicker>Up next</Kicker>
      <Text style={styles.cardTitle}>{matchup.opponent_team_name}</Text>
      <Row
        first
        left="Record"
        right={`${matchup.opponent_record ?? '–'}${matchup.opponent_result_streak ? ` · ${matchup.opponent_result_streak}` : ''}`}
      />
      {matchup.opponent_power_rank != null && <Row left="Power rank" right={`#${matchup.opponent_power_rank}`} />}
      {h2h && myWins + theirWins + h2h.ties > 0 && (
        <Row
          left="Head to head"
          right={`You ${myWins}–${theirWins}${h2h.ties ? `–${h2h.ties}` : ''}${h2h.last_season ? ` · last met ${h2h.last_season} Wk ${h2h.last_week}` : ''}`}
        />
      )}
      <Row left="Projected" right={`${fmt(matchup.my_projected_total)} – ${fmt(matchup.opponent_projected_total)}`} />
    </Panel>
  );
}

// Who got hurt Sunday (from last week's games) and who's on the report now.
export function InjuryReportCard({ lastWeek, roster, title }: { lastWeek: RosterPlayer[]; roster: RosterEntry[]; title: string }) {
  const hurtInGame = lastWeek.filter((p) => p.in_game_injury && p.in_game_injury.state !== 'returned');
  const listed = roster.filter((p) => p.injury_status && !['active', 'healthy'].includes(p.injury_status.toLowerCase()));
  if (hurtInGame.length === 0 && listed.length === 0) return null;
  const color = (status: string) => (['out', 'ir', 'injured reserve', 'doubtful', 'suspended', 'pup'].includes(status.toLowerCase()) ? DOWN : '#f5b942');
  return (
    <Panel onPress={() => router.navigate('/team')} label="Open your roster">
      <Kicker>{title}</Kicker>
      {hurtInGame.map((p, i) => (
        <Row key={`g${p.player_name}`} first={i === 0} left={`${p.player_name} left his game`} right={<Chip color={DOWN}>{p.in_game_injury?.detail ?? 'Hurt'}</Chip>} />
      ))}
      {listed.map((p, i) => (
        <Row
          key={p.player_id}
          first={hurtInGame.length === 0 && i === 0}
          left={
            <View style={styles.gap2}>
              <Text style={styles.rowText}>
                {p.player_name} · {p.position}
                {!isStarter(p.lineup_slot) ? ' (bench)' : ''}
              </Text>
              {p.practice_participation ? <Text style={styles.small}>Practice: {p.practice_participation}</Text> : null}
            </View>
          }
          right={<Chip color={color(p.injury_status!)}>{p.injury_status}</Chip>}
        />
      ))}
    </Panel>
  );
}

// Free agents worth a look: by last week's points, or this week's projection.
export function FreeAgentsCard({ players, by, title, color }: { players: FreeAgent[]; by: 'last' | 'projected'; title: string; color: string }) {
  const value = (p: FreeAgent) => (by === 'last' ? p.last_week_score : p.projected_points) ?? 0;
  const top = players.filter((p) => !p.rostered_team_id && value(p) > 0).sort((a, b) => value(b) - value(a)).slice(0, 4);
  if (top.length === 0) return null;
  return (
    <Panel>
      <Kicker>{title}</Kicker>
      {top.map((p, i) => (
        <Row
          key={p.sleeper_player_id}
          first={i === 0}
          left={
            <View style={styles.gap2}>
              <Text style={styles.rowText}>
                {p.full_name} <Text style={styles.small}>{p.position}{p.pro_team ? ` · ${p.pro_team}` : ''}</Text>
              </Text>
              <Text style={styles.small}>{p.waiver_clears_at || p.game_locked ? 'On waivers · claim' : 'Free agent · add now'}</Text>
            </View>
          }
          right={<Display style={styles.rowScore}>{value(p).toFixed(1)}</Display>}
        />
      ))}
      <LinkText color={color} onPress={() => router.navigate('/players')}>
        All free agents →
      </LinkText>
    </Panel>
  );
}

// Which side wins each position on paper this week.
export function PositionEdgeCard({ me, them }: { me: MatchupContextSide; them: MatchupContextSide }) {
  const total = (side: MatchupContextSide) => {
    const byPos = new Map<string, number>();
    for (const p of side.roster) {
      if (!isStarter(p.lineup_slot) || !p.position) continue;
      const pos = p.position === 'DST' ? 'DEF' : p.position;
      byPos.set(pos, (byPos.get(pos) ?? 0) + (p.live_projected ?? p.points_projected ?? 0));
    }
    return byPos;
  };
  const mine = total(me);
  const theirs = total(them);
  const order = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
  const positions = order.filter((p) => mine.has(p) || theirs.has(p));
  if (positions.length === 0) return null;
  const wins = positions.filter((p) => (mine.get(p) ?? 0) > (theirs.get(p) ?? 0)).length;
  return (
    <Panel>
      <Kicker>Position by position · you win {wins} of {positions.length}</Kicker>
      <View style={styles.positions}>
        {positions.map((p) => {
          const a = mine.get(p) ?? 0;
          const b = theirs.get(p) ?? 0;
          return (
            <View key={p} style={styles.position}>
              <Text style={styles.small}>{p}</Text>
              <Text style={[styles.positionNum, { color: a > b ? UP : a < b ? DOWN : Colors.text }]}>{a > b ? '+' : a < b ? '−' : ''}{Math.abs(a - b).toFixed(1)}</Text>
            </View>
          );
        })}
      </View>
    </Panel>
  );
}

// Trade offers waiting on you, or on them.
export function TradesCard({ trades, teamId, color }: { trades: Trade[]; teamId: number; color: string }) {
  const open = trades.filter((t) => ['pending', 'awaiting_review', 'in_review'].includes(t.status));
  if (open.length === 0) return null;
  return (
    <Panel tint={color} onPress={() => router.push('/trades')} label="Open trades">
      <Kicker color={color}>Trades</Kicker>
      {open.map((t, i) => (
        <Row
          key={t.id}
          first={i === 0}
          left={t.receiving_team_id === teamId ? `Offer from ${t.proposing_team_name ?? 'a team'}` : `Your offer to ${t.receiving_team_name ?? 'a team'}`}
          right={<Chip color={color}>{t.receiving_team_id === teamId && t.status === 'pending' ? 'Review' : t.status === 'pending' ? 'Waiting' : 'In review'}</Chip>}
        />
      ))}
    </Panel>
  );
}

// Your byes over the next three weeks and who covers them.
export function ByePlannerCard({ roster, week }: { roster: RosterEntry[]; week: number }) {
  const weeks = [week, week + 1, week + 2];
  const rows = weeks
    .map((w) => ({ week: w, out: roster.filter((p) => p.bye_week === w && isStarter(p.lineup_slot)) }))
    .filter((r) => r.out.length > 0);
  if (rows.length === 0) return null;
  return (
    <Panel>
      <Kicker>Bye weeks ahead</Kicker>
      {rows.map((r, i) => {
        const covers = r.out.map((p) => {
          const backup = roster
            .filter((b) => !isStarter(b.lineup_slot) && b.position === p.position && b.bye_week !== r.week)
            .sort((a, b) => (b.points_projected ?? 0) - (a.points_projected ?? 0))[0];
          return `${p.player_name.split(' ').slice(-1)[0]} (${backup ? backup.player_name.split(' ').slice(-1)[0] : 'no backup'})`;
        });
        return <Row key={r.week} first={i === 0} left={`Week ${r.week}`} right={<Text style={[styles.right, { color: covers.some((c) => c.includes('no backup')) ? DOWN : Colors.text }]}>{covers.join(', ')}</Text>} />;
      })}
    </Panel>
  );
}

// Trade and keeper deadlines coming up within a week.
export function DeadlinesCard({ trade, keeper, now }: { trade: TradeSettings | null; keeper: KeeperRules | null; now: Date }) {
  const soon = (iso: string | null | undefined) => {
    if (!iso) return null;
    const t = new Date(iso);
    const ms = t.getTime() - now.getTime();
    return ms > 0 && ms < 7 * 24 * 60 * 60 * 1000 ? t : null;
  };
  const tradeAt = soon(trade?.trade_deadline);
  const keeperAt = keeper?.is_open ? soon(keeper.keeper_deadline) : null;
  if (!tradeAt && !keeperAt) return null;
  return (
    <Panel tint={DOWN}>
      <Kicker color={DOWN}>Deadlines</Kicker>
      {tradeAt && <Row first left="Trade deadline" right={`in ${untilText(tradeAt, now)}`} />}
      {keeperAt && <Row first={!tradeAt} left="Keeper deadline" right={`in ${untilText(keeperAt, now)}`} />}
    </Panel>
  );
}

const styles = StyleSheet.create({
  bigRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, flexWrap: 'wrap' },
  big: { fontSize: 40, lineHeight: 46, color: Colors.text },
  arrow: { color: Colors.textSecondary, fontSize: 22 },
  muted: { color: Colors.textSecondary, fontSize: 13, flexShrink: 1 },
  body: { color: Colors.text, fontSize: 14 },
  small: { color: Colors.textSecondary, fontSize: 12 },
  right: { fontSize: 14, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  rowText: { color: Colors.text, fontSize: 14 },
  rowScore: { fontSize: 20, color: Colors.text },
  cardTitle: { color: Colors.text, fontSize: 17, fontWeight: '700' },
  gap2: { gap: 2, flexShrink: 1 },
  spark: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 56 },
  sparkCol: { alignItems: 'center', gap: 2 },
  sparkBar: { width: 14, borderRadius: 3 },
  sparkLabel: { color: Colors.textSecondary, fontSize: 9 },
  positions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  position: { minWidth: 52, flexGrow: 1, backgroundColor: Colors.tile, borderRadius: 10, padding: 8, alignItems: 'center', gap: 2 },
  positionNum: { fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
  stakes: { flexDirection: 'row', gap: 8 },
  stake: { flex: 1, borderWidth: 1, borderRadius: 10, padding: 10, gap: 2, backgroundColor: Colors.tile },
  stakeNum: { fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] },
  rootName: { color: Colors.text, fontWeight: '700' },
});
