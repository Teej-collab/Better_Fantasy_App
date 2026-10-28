import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { AdminScreen, AdminSection, adminStyles as s, BarRow, Divided, EmptyNote, formatWhen, StatTile, TileGrid, WindowPicker } from '@/components/admin/AdminUI';
import { Text } from '@/components/Text';
import { LoadingState } from '@/components/ui';
import { api } from '@/lib/api';

// Admin > AI Costs (2026-10-28): what the AI write-ups, roasts, hype
// grades and bet slip reads actually cost, by feature and by league,
// and what that projects to at 100 leagues (backend app/ai_usage.py).

const FEATURE_LABELS: Record<string, string> = {
  matchup_preview: 'Matchup previews',
  matchup_recap: 'Matchup recaps',
  weekly_recap: 'Weekly recaps',
  weekly_preview: 'Weekly previews',
  draft_writeup: 'Draft write-ups',
  rivalry_name: 'Rivalry names',
  chug_roast: 'Chug roasts',
  chug_hype: 'Chug hype grades',
  bet_slip: 'Bet slip reads',
  untagged: 'Other',
};

function money(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  if (n === 0) return '$0';
  if (n < 0.01) return `${(n * 100).toFixed(2)}¢`;
  return `$${n.toFixed(n < 10 ? 2 : 0)}`;
}

export default function AdminAiCostsScreen() {
  const [days, setDays] = useState(7);
  const q = useQuery({ queryKey: ['admin', 'ai-usage', days], queryFn: () => api.admin.aiUsage(days) });
  const data = q.data;
  const topFeature = Math.max(0.0001, ...(data?.by_feature.map((f) => f.cost) ?? [0]));
  const topLeague = Math.max(0.0001, ...(data?.by_league.map((l) => l.cost) ?? [0]));
  const perWeek = data?.per_league_per_week ?? null;

  return (
    <AdminScreen>
      <Stack.Screen options={{ title: 'AI Costs' }} />
      <WindowPicker value={days} onChange={setDays} disabled={q.isFetching} />
      {!data ? (
        q.isPending ? <LoadingState /> : <Text style={s.error}>Couldn&apos;t load AI costs.</Text>
      ) : data.calls === 0 ? (
        <AdminSection title="AI Costs">
          <EmptyNote>Nothing recorded yet. Costs show up here as write-ups, roasts and bet slips run.</EmptyNote>
        </AdminSection>
      ) : (
        <>
          <Text style={s.small}>
            Real cost of every AI call (Claude Sonnet 5, $2 per million tokens in, $10 out).
            {data.since ? ` Tracking began ${formatWhen(data.since)}.` : ''}
          </Text>
          <TileGrid>
            <StatTile label={`Last ${days} days`} value={money(data.total_cost)} hint={`${data.calls} calls`} />
            <StatTile label="Per league, per week" value={money(perWeek)} />
            <StatTile label="At 100 leagues" value={perWeek === null ? '—' : `${money(perWeek * 100)}/wk`} hint="same usage per league" />
            <StatTile label="100 leagues, a season" value={perWeek === null ? '—' : money(perWeek * 100 * 17)} hint="17 weeks" />
          </TileGrid>

          <AdminSection title="By feature" hint="What each kind of write-up costs.">
            {data.by_feature.map((f, i) => (
              <Divided key={f.feature} index={i}>
                <BarRow
                  label={FEATURE_LABELS[f.feature] ?? f.feature}
                  value={f.cost}
                  max={topFeature}
                  right={`${money(f.cost)} · ${f.calls}× · ${money(f.calls ? f.cost / f.calls : 0)} each`}
                />
              </Divided>
            ))}
          </AdminSection>

          <AdminSection title="By league">
            {data.by_league.map((l, i) => (
              <Divided key={l.league_id ?? 'none'} index={i}>
                <View>
                  <BarRow label={l.name} value={l.cost} max={topLeague} right={`${money(l.cost)} · ${l.calls}×`} />
                </View>
              </Divided>
            ))}
          </AdminSection>
        </>
      )}
    </AdminScreen>
  );
}
