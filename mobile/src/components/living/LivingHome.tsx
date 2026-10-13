import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { useTabScrollRef } from '@/components/TabFrame';
import { ActivityCard } from '@/components/home/FeedCards';
import {
  AwardsMiniCard,
  Chip,
  ClaimResultsCard,
  KickoffCard,
  Kicker,
  LineupCheckCard,
  LinkText,
  LoungeCard,
  MatchupPreviewCard,
  Panel,
  PlayersNowCard,
  ScoreLine,
  useNow,
  WaiversCountdownCard,
  WeekEndedCard,
  WinBar,
} from '@/components/living/LivingCards';
import { Display, Text } from '@/components/Text';
import { LoadingState, MessageState } from '@/components/ui';
import { Colors, Spacing } from '@/constants/theme';
import {
  dayName,
  etDayHour,
  fmt,
  homePhase,
  isStarter,
  matchupDone,
  nextEt,
  PHASE_COLOR,
  sideFor,
  startersPlayingToday,
  untilText,
  type HomePhase,
} from '@/lib/livingHome';
import {
  queryClient,
  useHomeAwards,
  useHomeRecap,
  useLeagueActivity,
  useMatchupContext,
  useMe,
  useMyTeam,
  useMyWeek,
  useNflScoreboard,
  useSeasonWeek,
  useStandings,
  useWaiverClaims,
} from '@/lib/queries';
import { lastRun } from '@/lib/waiverClaims';

// The recap's opening, without markdown, cut at a sentence near `max`.
function excerpt(text: string, max = 220): string {
  const plain = text
    .replace(/^#+\s.*$/gm, '')
    .replace(/[*_>#`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max);
  const stop = cut.lastIndexOf('. ');
  return `${stop > 80 ? cut.slice(0, stop + 1) : cut.trimEnd()}…`;
}

function greeting(name: string | null, now: Date): string {
  const h = now.getHours();
  const part = h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : 'Evening';
  return name ? `${part}, ${name}` : part;
}

/**
 * The living home screen (2026-10-13, testers only): one screen that
 * follows the fantasy week — recap on Tuesday, waiver results Wednesday,
 * lineup checks before kickoff, the live score on Sunday, the sweat on
 * Monday night and the result once it's final.
 */
export function LivingHome({ onUseClassic }: { onUseClassic: () => void }) {
  const scrollRef = useTabScrollRef<ScrollView>();
  const now = useNow();
  const me = useMe().data ?? null;
  const seasonWeek = useSeasonWeek();
  const season = seasonWeek.data?.season ?? null;
  const week = seasonWeek.data?.week ?? null;
  const myWeek = useMyWeek();
  const games = useNflScoreboard().data ?? [];
  const myTeam = useMyTeam().data ?? null;
  const roster = myTeam?.roster ?? [];
  const claims = useWaiverClaims().data ?? null;
  const standings = useStandings(season).data?.standings ?? [];
  const context = useMatchupContext(season, week).data ?? null;
  const awards = useHomeAwards(season, week).data ?? null;
  const recap = useHomeRecap(season, week).data ?? null;
  const activity = useLeagueActivity(season, 4).data ?? [];
  const [refreshing, setRefreshing] = useState(false);

  const phase: HomePhase = homePhase({ now, myWeek: myWeek.data ?? null, games, roster });
  const lastWeek = phase === 'recap' && week !== null && week > 1 ? week - 1 : null;
  const lastContext = useMatchupContext(lastWeek !== null ? season : null, lastWeek).data ?? null;

  async function onRefresh() {
    setRefreshing(true);
    await queryClient.invalidateQueries();
    setRefreshing(false);
  }

  if (myWeek.isPending && seasonWeek.isPending) return <LoadingState />;
  if (!myWeek.data) {
    return <MessageState message="You're signed in, but not on a team yet. Join or create a league to get started." />;
  }

  const color = PHASE_COLOR[phase];
  const m = myWeek.data.matchup;
  const teamId = myWeek.data.team_id;
  const mine = context ? sideFor(context.matchups, teamId) : null;
  const myRow = standings.find((r) => r.team_id === teamId);
  const record = myRow ? `${myRow.wins}–${myRow.losses}${myRow.ties ? `–${myRow.ties}` : ''}` : null;
  const name = me?.display_name ?? null;
  const day = dayName(now);

  let header: { kicker: string; title: string; live?: boolean; right?: string };
  let body: ReactNode;

  const preview = m ? (
    <MatchupPreviewCard
      matchupId={m.matchup_id}
      myProjection={m.my_projected_total}
      theirProjection={m.opponent_projected_total}
      opponent={m.opponent_team_name}
      winProbability={m.win_probability}
      color={color}
    />
  ) : null;

  switch (phase) {
    case 'final': {
      const my = m?.my_score ?? 0;
      const their = m?.opponent_score ?? 0;
      const won = my > their;
      const tie = my === their;
      const closest = (context?.matchups ?? [])
        .filter((x) => x.home.score != null && x.away.score != null)
        .map((x) => ({
          label: `${(x.home.score ?? 0) >= (x.away.score ?? 0) ? x.home.owner_name : x.away.owner_name} over ${(x.home.score ?? 0) >= (x.away.score ?? 0) ? x.away.owner_name : x.home.owner_name}`,
          margin: Math.abs((x.home.score ?? 0) - (x.away.score ?? 0)),
        }))
        .sort((a, b) => a.margin - b.margin)[0] ?? null;
      const recapOut = recap && recap.week === week && recap.recap.released !== false;
      const flip = nextEt(2, 15, now);
      header = {
        kicker: `${day} · Final`,
        title: tie ? `A tie in Week ${week}` : won ? `You won Week ${week}` : `Week ${week} got away`,
      };
      body = (
        <>
          <Panel tint={won ? color : Colors.loss} style={styles.center}>
            <Kicker color={won ? color : Colors.loss}>{tie ? 'Final · Tie' : won ? 'Final · Win' : 'Final · Loss'}</Kicker>
            <ScoreLine mine={m?.my_score ?? null} theirs={m?.opponent_score ?? null} color={won ? color : Colors.text} mineLabel="You" theirLabel={m?.opponent_team_name} />
            {record && <Text style={styles.body}>Now {record}</Text>}
            <View style={styles.buttons}>
              <Pressable style={[styles.button, { backgroundColor: color }]} onPress={() => router.navigate('/chat')} accessibilityRole="button">
                <Text style={styles.buttonText}>{won ? 'Talk trash' : 'Face the chat'}</Text>
              </Pressable>
              {m && (
                <Pressable
                  style={[styles.button, styles.buttonQuiet]}
                  onPress={() => router.push({ pathname: '/matchup/[id]', params: { id: String(m.matchup_id) } })}
                  accessibilityRole="button">
                  <Text style={styles.buttonQuietText}>Open matchup</Text>
                </Pressable>
              )}
            </View>
          </Panel>
          <WeekEndedCard me={mine?.me ?? null} closest={closest} />
          {recapOut && season !== null && week !== null ? (
            <Panel onPress={() => router.push({ pathname: '/recap/[season]/[week]', params: { season: String(season), week: String(week) } })} label="Read the recap">
              <Kicker color="#f5b942">The Week {week} recap is out</Kicker>
              <Text style={styles.body}>{excerpt(recap.recap.text, 140)}</Text>
            </Panel>
          ) : (
            <Panel>
              <View style={styles.spread}>
                <View style={styles.gap2}>
                  <Kicker>Coming up</Kicker>
                  <Text style={styles.body}>The Week {week} recap and awards</Text>
                </View>
                <Text style={styles.muted}>in {untilText(flip, now)}</Text>
              </View>
            </Panel>
          )}
        </>
      );
      break;
    }

    case 'recap': {
      const last = lastContext ? sideFor(lastContext.matchups, teamId) : null;
      const lastRecap = recap && recap.week === lastWeek && recap.recap.released !== false ? recap : null;
      const won = last && (last.me.score ?? 0) > (last.them.score ?? 0);
      header = { kicker: 'Tuesday · Recap day', title: greeting(name, now) };
      body = (
        <>
          {last && (
            <Panel tint="#f5b942">
              <Kicker color="#f5b942">Your Week {lastWeek} · Final</Kicker>
              <ScoreLine
                mine={last.me.score}
                theirs={last.them.score}
                color={won ? '#39ff14' : Colors.text}
                mineLabel={record ? `You · ${record}` : 'You'}
                theirLabel={last.them.team_name}
                middle={<Chip color={won ? '#39ff14' : Colors.loss}>{won ? 'W' : 'L'} · {Math.abs((last.me.score ?? 0) - (last.them.score ?? 0)).toFixed(1)}</Chip>}
              />
              {lastRecap && <Text style={styles.quote}>“{excerpt(lastRecap.recap.text)}”</Text>}
              {lastRecap && season !== null && (
                <LinkText
                  color="#f5b942"
                  onPress={() => router.push({ pathname: '/recap/[season]/[week]', params: { season: String(season), week: String(lastWeek) } })}>
                  Read the Week {lastWeek} recap →
                </LinkText>
              )}
            </Panel>
          )}
          {awards && season !== null && <AwardsMiniCard awards={awards.awards} week={awards.week} season={season} color={color} />}
          <WaiversCountdownCard claims={claims} now={now} color="#4cc3ff" />
        </>
      );
      break;
    }

    case 'waivers': {
      const run = lastRun(claims?.claims ?? []).filter(
        (c) => now.getTime() - new Date(c.processed_at!).getTime() < 36 * 60 * 60 * 1000,
      );
      header = { kicker: 'Wednesday · Waivers cleared', title: `Week ${week} starts now` };
      body = (
        <>
          <ClaimResultsCard run={run} color={color} />
          {preview}
          {activity.length > 0 && <ActivityCard items={activity} />}
        </>
      );
      break;
    }

    case 'lock': {
      const tonight = startersPlayingToday(roster, now);
      header = {
        kicker: `${day} · ${etDayHour(now).hour < 17 ? 'First lock today' : 'First lock tonight'}`,
        title: 'Lineup check',
      };
      body = (
        <>
          <KickoffCard players={tonight} now={now} color={color} title="Locks in" />
          <LineupCheckCard roster={roster} slots={myTeam?.roster_slots ?? null} week={week} color={color} />
          {preview}
          <LoungeCard title="Tonight in the Lounge" body="Watch the game with your league" />
        </>
      );
      break;
    }

    case 'prep': {
      const upcoming = roster.filter((p) => isStarter(p.lineup_slot) && !p.is_locked && p.game_time && new Date(p.game_time) > now);
      header = {
        kicker: `${day} · Lineup prep`,
        title: upcoming.length > 0 ? `${upcoming.length} of your starters still to play` : 'Get your lineup right',
      };
      body = (
        <>
          <LineupCheckCard roster={roster} slots={myTeam?.roster_slots ?? null} week={week} color={color} />
          <KickoffCard players={upcoming} now={now} color={color} title="Your next kickoff" />
          {preview}
        </>
      );
      break;
    }

    case 'live': {
      const liveGames = games.filter((g) => g.state === 'in').length;
      const margin = (m?.my_score ?? 0) - (m?.opponent_score ?? 0);
      const onNow = (mine?.me.roster ?? [])
        .filter((p) => isStarter(p.lineup_slot) && p.game_status === 'in_progress')
        .sort((a, b) => (b.points_scored ?? 0) - (a.points_scored ?? 0));
      header = { kicker: `Live · ${day}`, title: margin >= 0 ? "You're ahead" : 'Chasing it', live: true, right: `${liveGames} game${liveGames === 1 ? '' : 's'} on now` };
      body = (
        <>
          {m && (
            <Panel tint={color} onPress={() => router.push({ pathname: '/matchup/[id]', params: { id: String(m.matchup_id) } })} label="Open your matchup">
              <ScoreLine
                mine={m.my_score}
                theirs={m.opponent_score}
                color={margin >= 0 ? color : Colors.text}
                mineLabel={`You · proj ${fmt(mine?.me.projected_total ?? m.my_projected_total)}`}
                theirLabel={`${m.opponent_team_name} · proj ${fmt(mine?.them.projected_total ?? m.opponent_projected_total)}`}
                middle={<Chip color={margin >= 0 ? color : Colors.loss}>{`${margin >= 0 ? '+' : '−'}${Math.abs(margin).toFixed(1)}`}</Chip>}
              />
              {m.win_probability != null && <WinBar percent={m.win_probability} color={color} />}
              <View style={styles.spread}>
                {m.win_probability != null && <Text style={styles.muted}>{Math.round(m.win_probability)}% to win</Text>}
                <Text style={styles.muted}>
                  You {m.my_yet_to_play + m.my_in_play} left · Them {m.opponent_yet_to_play + m.opponent_in_play} left
                </Text>
              </View>
            </Panel>
          )}
          <PlayersNowCard players={onNow} title="Your players right now" />
          <LoungeCard title="League Lounge" body="Watch the games together" />
        </>
      );
      break;
    }

    case 'sweat': {
      const margin = (m?.my_score ?? 0) - (m?.opponent_score ?? 0);
      const myLeft = (mine?.me.roster ?? []).filter((p) => isStarter(p.lineup_slot) && p.game_status !== 'final');
      const theirLeft = (mine?.them.roster ?? []).filter((p) => isStarter(p.lineup_slot) && p.game_status !== 'final');
      const remaining = (ps: typeof myLeft) =>
        ps.reduce((sum, p) => sum + Math.max(0, (p.live_projected ?? p.points_projected ?? 0) - (p.points_scored ?? 0)), 0);
      const sweatColor = margin >= 0 ? '#39ff14' : '#ff8a3d';
      header = {
        kicker: `${etDayHour(now).day === 1 ? 'Monday Night' : `${day} night`} · The sweat`,
        title: margin >= 0 ? 'Hold on tonight' : 'It comes down to tonight',
      };
      body = (
        <>
          {m && (
            <Panel tint={sweatColor} onPress={() => router.push({ pathname: '/matchup/[id]', params: { id: String(m.matchup_id) } })} label="Open your matchup">
              <Kicker color={sweatColor}>
                {margin >= 0 ? `You're up ${margin.toFixed(1)}` : `You're down ${Math.abs(margin).toFixed(1)}`} · {myLeft.length} left vs {theirLeft.length}
              </Kicker>
              <Display style={[styles.huge, { color: sweatColor }]}>{fmt(m.my_score)}</Display>
              <Text style={styles.muted}>
                to {fmt(m.opponent_score)} · {m.opponent_team_name}
              </Text>
              <View style={styles.tiles}>
                <View style={styles.tile}>
                  <Text style={styles.muted}>Your players left could add</Text>
                  <Display style={styles.tileNumber}>{remaining(myLeft).toFixed(1)}</Display>
                </View>
                <View style={styles.tile}>
                  <Text style={styles.muted}>Theirs could add</Text>
                  <Display style={styles.tileNumber}>{remaining(theirLeft).toFixed(1)}</Display>
                </View>
              </View>
              {m.win_probability != null && (
                <View style={styles.spread}>
                  <Text style={styles.muted}>{myLeft.map((p) => p.player_name).join(', ') || 'Nobody left for you'}</Text>
                  <Chip color={sweatColor}>{Math.round(m.win_probability)}% to win</Chip>
                </View>
              )}
            </Panel>
          )}
          <PlayersNowCard players={myLeft} title="Still to play for you" />
          <LoungeCard title="Sweat it together" body="The Lounge is open for tonight's game" />
        </>
      );
      break;
    }
  }

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.screen}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={color} />}>
      <View style={styles.header}>
        <View style={styles.spread}>
          <View style={styles.kickerRow}>
            {header.live && <View style={styles.liveDot} />}
            <Kicker color={header.live ? Colors.live : color}>{header.kicker}</Kicker>
          </View>
          {header.right && <Text style={styles.muted}>{header.right}</Text>}
        </View>
        <Text style={styles.title}>{header.title}</Text>
      </View>
      {body}
      {!matchupDone(myWeek.data) && phase !== 'live' && phase !== 'sweat' && m === null && (
        <Panel>
          <Text style={styles.muted}>No matchup this week.</Text>
        </Panel>
      )}
      <Pressable onPress={onUseClassic} hitSlop={8} style={styles.footer} accessibilityRole="button">
        <Text style={styles.footerText}>Testing the new home · Switch to the classic one</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xl * 2, gap: 14 },
  header: { gap: 2 },
  kickerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  liveDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: Colors.live },
  title: { color: Colors.text, fontSize: 24, fontWeight: '700' },
  spread: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md },
  gap2: { gap: 2, flexShrink: 1 },
  center: { alignItems: 'center' },
  body: { color: Colors.text, fontSize: 14 },
  muted: { color: Colors.textSecondary, fontSize: 13, flexShrink: 1 },
  quote: { color: Colors.text, fontSize: 14, lineHeight: 20, fontStyle: 'italic' },
  buttons: { flexDirection: 'row', gap: 8 },
  button: { minHeight: 44, borderRadius: 999, paddingHorizontal: 18, justifyContent: 'center' },
  buttonText: { color: '#0b0e13', fontSize: 14, fontWeight: '700' },
  buttonQuiet: { backgroundColor: Colors.tileRaised },
  buttonQuietText: { color: Colors.text, fontSize: 14, fontWeight: '600' },
  huge: { fontSize: 64, lineHeight: 68 },
  tiles: { flexDirection: 'row', gap: 10 },
  tile: { flex: 1, backgroundColor: Colors.tile, borderRadius: 12, padding: 10, gap: 2 },
  tileNumber: { fontSize: 24, color: Colors.text },
  footer: { alignSelf: 'center', paddingVertical: Spacing.md },
  footerText: { color: Colors.textSecondary, fontSize: 12 },
});
