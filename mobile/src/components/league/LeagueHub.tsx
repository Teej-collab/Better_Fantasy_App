import { Pressable, StyleSheet, View } from 'react-native';

import { Card } from '@/components/ui';
import { Text } from '@/components/Text';
import { Spacing } from '@/constants/theme';
import { ordinal } from '@/lib/bracketEngine';
import { haptics } from '@/lib/haptics';
import { useLeagueActivity, useMe, useMyWeek, usePowerRankingsTrend, useRivalries, useScoringCatalog, useSeasonTeams, useStandings } from '@/lib/queries';
import { scoringSummary } from '@/lib/scoringDisplay';
import type { LeagueActivityItem } from '@/lib/types';

// The League tab's front page (2026-10-22, League page mockup C): every
// section as a card showing your own line from it, so nothing hides in
// a scrolling chip row. Tapping a card opens that section.

export type HubSection = 'league' | 'standings' | 'powerRankings' | 'rivalries' | 'scoring' | 'rules' | 'history' | 'activity';

const COLORS = {
  standings: '#4ade80',
  power: '#facc15',
  rivalries: '#ff8a3d',
  activity: '#4cc3ff',
  teams: '#c084fc',
  scoring: '#2dd4bf',
  rules: '#9aa3b2',
  history: '#f472b6',
};

function describeMove(item: LeagueActivityItem): { title: string; detail: string } {
  if (item.kind === 'trade') {
    return { title: `${item.proposing_owner_name} ↔ ${item.receiving_owner_name}`, detail: 'Latest trade' };
  }
  const who = item.owner_name;
  if (item.added_player_name) return { title: `${who} added ${item.added_player_name}`, detail: item.source === 'waiver' ? 'Off waivers' : 'Latest pickup' };
  if (item.dropped_player_name) return { title: `${who} dropped ${item.dropped_player_name}`, detail: 'Latest drop' };
  return { title: who, detail: 'Latest move' };
}

function HubCard({
  label,
  color,
  title,
  detail,
  onPress,
  wide,
}: {
  label: string;
  color: string;
  title: string | null;
  detail: string;
  onPress: () => void;
  wide?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}${title ? `, ${title}` : ''}. ${detail}`}
      onPress={() => {
        haptics.select();
        onPress();
      }}
      style={({ pressed }) => [wide ? styles.wide : styles.half, pressed && styles.pressed]}>
      <Card color={wide ? color : undefined} style={[styles.card, wide && styles.cardWide]} outerStyle={styles.fill}>
        <Text style={[styles.label, { color }]}>{label}</Text>
        {title ? (
          <Text style={wide ? styles.titleWide : styles.title} numberOfLines={2}>
            {title}
          </Text>
        ) : null}
        <Text style={styles.detail} numberOfLines={2}>
          {detail}
        </Text>
      </Card>
    </Pressable>
  );
}

export function LeagueHub({ season, onOpen }: { season: number | null; onOpen: (section: HubSection) => void }) {
  const myWeek = useMyWeek().data ?? null;
  const me = useMe().data ?? null;
  const teamId = myWeek?.team_id ?? null;
  const ownerId = me?.owner_id ?? null;
  const standings = useStandings(season).data?.standings ?? [];
  const trend = usePowerRankingsTrend(season).data ?? [];
  const rivalries = useRivalries().data ?? [];
  const activity = useLeagueActivity(season, 1).data ?? [];
  const teams = useSeasonTeams(season).data ?? [];
  const scoring = useScoringCatalog().data;

  const myIndex = standings.findIndex((r) => r.team_id === teamId);
  const mine = myIndex >= 0 ? standings[myIndex] : null;
  const place = mine ? (mine.final_rank ?? myIndex + 1) : null;
  const record = mine ? `${mine.wins}-${mine.losses}${mine.ties ? `-${mine.ties}` : ''}` : null;

  const myTrend = trend.find((t) => t.team_id === teamId);
  const weeks = myTrend?.weeks ?? [];
  const nowRank = weeks.at(-1)?.power_rank ?? null;
  const prevRank = weeks.at(-2)?.power_rank ?? null;
  const moved =
    nowRank === null || prevRank === null
      ? 'Power rankings'
      : nowRank < prevRank
        ? `Up ${prevRank - nowRank} from last week`
        : nowRank > prevRank
          ? `Down ${nowRank - prevRank} from last week`
          : 'Same as last week';

  const myRivalries = ownerId === null ? [] : rivalries.filter((r) => r.owner_a_id === ownerId || r.owner_b_id === ownerId);
  const rival = myRivalries[0] ?? null;
  const rivalName = rival ? (rival.owner_a_id === ownerId ? rival.owner_b_name : rival.owner_a_name) : null;
  const series = rival
    ? (() => {
        const mineWins = rival.owner_a_id === ownerId ? rival.all_time_wins_a : rival.all_time_wins_b;
        const theirWins = rival.owner_a_id === ownerId ? rival.all_time_wins_b : rival.all_time_wins_a;
        const lead = mineWins > theirWins ? 'You lead' : mineWins < theirWins ? 'They lead' : 'Tied';
        const more = myRivalries.length > 1 ? ` · +${myRivalries.length - 1} more` : '';
        return `${lead} ${Math.max(mineWins, theirWins)}-${Math.min(mineWins, theirWins)}${more}`;
      })()
    : 'Every rivalry in the league';

  const latest = activity[0] ? describeMove(activity[0]) : null;

  return (
    <View style={styles.grid}>
      <HubCard
        wide
        label="Standings"
        color={COLORS.standings}
        title={place ? `${ordinal(place)} · ${record}` : null}
        detail="Scores · Table · Playoffs and What-If"
        onPress={() => onOpen('standings')}
      />
      <HubCard label="Power" color={COLORS.power} title={nowRank ? `#${nowRank}` : null} detail={moved} onPress={() => onOpen('powerRankings')} />
      <HubCard label="Rivalries" color={COLORS.rivalries} title={rivalName} detail={series} onPress={() => onOpen('rivalries')} />
      <HubCard
        wide
        label="Activity"
        color={COLORS.activity}
        title={latest?.title ?? null}
        detail={latest?.detail ?? 'Trades and pickups'}
        onPress={() => onOpen('activity')}
      />
      <HubCard label="Teams" color={COLORS.teams} title={teams.length ? `${teams.length} teams` : null} detail="Owners and polls" onPress={() => onOpen('league')} />
      <HubCard
        label="Scoring"
        color={COLORS.scoring}
        title={scoring ? (scoringSummary(scoring)[0] ?? null) : null}
        detail="Every stat and what it's worth"
        onPress={() => onOpen('scoring')}
      />
      <HubCard label="Rules" color={COLORS.rules} title={null} detail="Waivers, playoffs, house rules" onPress={() => onOpen('rules')} />
      <HubCard label="History" color={COLORS.history} title={null} detail="Recaps, awards, cards" onPress={() => onOpen('history')} />
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: Spacing.md },
  wide: { width: '100%' },
  half: { width: '48.5%' },
  pressed: { opacity: 0.75, transform: [{ scale: 0.985 }] },
  fill: { flex: 1 },
  card: { flex: 1, gap: Spacing.sm, minHeight: 112, justifyContent: 'space-between' },
  cardWide: { minHeight: 132 },
  label: { fontSize: 11, fontWeight: '800', letterSpacing: 1.5, textTransform: 'uppercase' },
  titleWide: { fontSize: 28, fontWeight: '800' },
  title: { fontSize: 18, fontWeight: '800' },
  detail: { color: 'rgba(255,255,255,0.6)', fontSize: 13 },
});
