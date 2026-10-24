import { router, Stack, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { CommishScreen, ErrorText, errorMessage } from '@/components/commissioner/CommishUI';
import { GroupTitle, Panel, PageTitle, partStyles as p, SmallButton, TONES, ToolRow } from '@/components/commissioner/CommishParts';
import { Text } from '@/components/Text';
import { LoadingState } from '@/components/ui';
import { Colors, Spacing } from '@/constants/theme';
import { trackTap } from '@/lib/analytics';
import { useAppearance } from '@/lib/appearance';
import { useCommishSummary } from '@/lib/queries';
import type { CommishSummary } from '@/lib/types';

// The Commissioner hub (2026-10-23 overhaul, mockup 1): what needs the
// commissioner right now, the league at a glance, then every tool in
// four groups, each row showing its current setting. The web's
// /commissioner hub matches.

type Tool = { title: string; href: Href; value: keyof CommishSummary['tools']; target: string; badge?: string };

const GROUPS: { title: string; color: string; tools: Tool[] }[] = [
  {
    title: 'League setup',
    color: TONES.blue,
    tools: [
      { title: 'League & format', href: '/commissioner/league', value: 'league', target: 'league' },
      { title: 'Scoring', href: '/commissioner/scoring', value: 'scoring', target: 'scoring' },
      { title: 'Roster & keepers', href: '/commissioner/roster', value: 'roster', target: 'roster' },
      { title: 'Waivers & free agents', href: '/commissioner/waivers' as Href, value: 'waivers', target: 'waivers', badge: 'NEW' },
    ],
  },
  {
    title: 'People',
    color: TONES.purple,
    tools: [
      { title: 'Members & teams', href: '/commissioner/members', value: 'members', target: 'members' },
      { title: 'Chat filter', href: '/commissioner/chat-filter' as Href, value: 'chat_filter', target: 'chat_filter' },
    ],
  },
  {
    title: 'Running the season',
    color: TONES.orange,
    tools: [
      { title: 'Season calendar', href: '/commissioner/calendar' as Href, value: 'calendar', target: 'calendar', badge: 'NEW' },
      { title: 'Trades', href: '/commissioner/trades', value: 'trades', target: 'trades' },
      { title: 'Fix a lineup', href: '/commissioner/lineup' as Href, value: 'lineup', target: 'lineup' },
      { title: 'Draft', href: '/draft', value: 'draft', target: 'draft' },
    ],
  },
  {
    title: 'League life',
    color: TONES.yellow,
    tools: [
      { title: 'Commish Corner', href: '/commissioner/corner' as Href, value: 'corner', target: 'corner', badge: 'NEW' },
      { title: 'Polls', href: '/commissioner/polls', value: 'polls', target: 'polls' },
      { title: 'Punishment Wheel', href: '/punishment-wheel' as Href, value: 'wheel', target: 'wheel' },
      { title: 'Bring your league in', href: '/commissioner/espn', value: 'espn', target: 'espn' },
    ],
  },
];

export default function CommissionerHub() {
  const summary = useCommishSummary();
  return (
    <CommishScreen>
      <Stack.Screen options={{ title: 'Commissioner' }} />
      <PageTitle title="Commissioner" subtitle={summary.data?.league.name} />
      {summary.data ? (
        <Hub data={summary.data} />
      ) : summary.isPending ? (
        <LoadingState />
      ) : (
        <ErrorText>{errorMessage(summary.error, "Couldn't load your league.")}</ErrorText>
      )}
    </CommishScreen>
  );
}

function Hub({ data }: { data: CommishSummary }) {
  const accent = useAppearance().accent;
  const g = data.glance;
  const glance = [
    { label: 'Teams', value: `${g.teams} · ${g.matchups}` },
    { label: 'Scoring', value: g.scoring },
    { label: 'Week', value: g.week ? `${g.week}${g.last_regular_week ? ` of ${g.last_regular_week}` : ''}` : 'Preseason' },
    { label: 'Playoffs', value: `${g.playoff_teams} teams · Wk ${g.playoff_start_week}+` },
  ];
  return (
    <>
      <Panel color={accent}>
        <View style={styles.needsHead}>
          <Text style={[p.label, { color: accent }]}>Needs you</Text>
          <Text style={p.sub}>{data.needs_you.length ? `${data.needs_you.length} thing${data.needs_you.length === 1 ? '' : 's'}` : 'All caught up'}</Text>
        </View>
        {data.needs_you.length === 0 ? (
          <Text style={[p.sub, styles.caughtUp]}>Nothing&apos;s waiting on you. Trades to review, lineups that need fixing and deadlines show up here.</Text>
        ) : (
          data.needs_you.map((n, i) => (
            <View key={`${n.kind}-${i}`} style={[styles.need, p.divided]}>
              <View style={[styles.dot, { backgroundColor: TONES[n.tone] }]} />
              <View style={p.flex}>
                <Text style={styles.needTitle}>{n.title}</Text>
                <Text style={p.sub} numberOfLines={1}>
                  {n.at ? new Date(n.at).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : n.sub}
                </Text>
              </View>
              <SmallButton
                label={n.action}
                onPress={() => {
                  trackTap(`commish.needs_${n.kind}`);
                  router.push(n.href as Href);
                }}
              />
            </View>
          ))
        )}
      </Panel>

      <View style={styles.glance}>
        {glance.map((t) => (
          <View key={t.label} style={styles.tile}>
            <Text style={p.label}>{t.label}</Text>
            <Text style={styles.tileValue} numberOfLines={1}>
              {t.value}
            </Text>
          </View>
        ))}
      </View>

      {GROUPS.map((group) => (
        <View key={group.title} style={styles.group}>
          <GroupTitle title={group.title} color={group.color} />
          <Panel>
            {group.tools.map((tool, i) => (
              <ToolRow key={tool.title} first={i === 0} title={tool.title} value={data.tools[tool.value]} href={tool.href} badge={tool.badge} target={tool.target} />
            ))}
          </Panel>
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  needsHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: 14, paddingTop: 14, paddingBottom: 10 },
  caughtUp: { paddingHorizontal: 14, paddingBottom: 14 },
  need: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: 14, paddingVertical: 12 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  needTitle: { color: Colors.text, fontSize: 15, fontWeight: '600' },
  glance: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { flexBasis: '47%', flexGrow: 1, backgroundColor: Colors.tile, borderRadius: 12, padding: 12, gap: 2 },
  tileValue: { color: Colors.text, fontSize: 16, fontWeight: '800' },
  group: { gap: Spacing.sm },
});
