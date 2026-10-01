import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AdminScreen, AdminSection, adminStyles as s, BarRow, Divided, EmptyNote, WindowPicker } from '@/components/admin/AdminUI';
import { Text } from '@/components/Text';
import { LoadingState } from '@/components/ui';
import { api } from '@/lib/api';
import { eventLabel } from '@/lib/analyticsEvents';

// Visual intensity, not just bar length — the busiest routes glow.
function intensity(views: number, max: number): number {
  return max === 0 ? 0 : Math.max(0.15, views / max);
}

// Port of the web's AdminNavigationHeatmap.
export default function AdminNavigationScreen() {
  const [days, setDays] = useState(30);
  const q = useQuery({
    queryKey: ['admin', 'navigation', days],
    queryFn: async () => {
      const [heatmap, features, paths] = await Promise.all([api.admin.navigation(days), api.admin.features(days), api.admin.paths(days)]);
      return { heatmap, features, paths };
    },
    placeholderData: keepPreviousData,
  });

  return (
    <AdminScreen>
      <Stack.Screen options={{ title: 'Navigation' }} />
      {!q.data ? (
        q.isPending ? <LoadingState /> : <Text style={s.error}>Couldn&apos;t load navigation.</Text>
      ) : (
        <Body {...q.data} days={days} setDays={setDays} loading={q.isFetching} />
      )}
    </AdminScreen>
  );
}

type Data = {
  heatmap: Awaited<ReturnType<typeof api.admin.navigation>>;
  features: Awaited<ReturnType<typeof api.admin.features>>;
  paths: Awaited<ReturnType<typeof api.admin.paths>>;
};

function Body({ heatmap, features, paths, days, setDays, loading }: Data & { days: number; setDays: (d: number) => void; loading: boolean }) {
  const maxViews = heatmap.routes[0]?.views ?? 0;
  return (
    <>
      <View style={s.between}>
        <Text style={s.small}>{heatmap.total_views} total page views</Text>
        <WindowPicker value={days} onChange={setDays} disabled={loading} />
      </View>

      <AdminSection title="Page Heat Map">
        {heatmap.routes.length === 0 ? (
          <EmptyNote>No page views recorded in this window yet.</EmptyNote>
        ) : (
          heatmap.routes.map((r) => {
            const alpha = intensity(r.views, maxViews);
            return (
              <View key={r.event_name} style={{ gap: 3 }}>
                <View style={s.between}>
                  <Text style={s.body}>{eventLabel(r.event_name)}</Text>
                  <Text style={s.small}>
                    {r.views} views · {r.unique_owners} people
                  </Text>
                </View>
                <View style={styles.track}>
                  <View
                    style={[
                      styles.fill,
                      {
                        width: `${Math.max(3, (r.views / maxViews) * 100)}%`,
                        backgroundColor: `rgba(56,189,248,${alpha.toFixed(2)})`,
                        shadowOpacity: alpha > 0.6 ? 0.9 : 0,
                      },
                    ]}
                  />
                </View>
              </View>
            );
          })
        )}
      </AdminSection>

      <AdminSection title="Where People Go Next" hint="The most common page-to-page moves within a visit.">
        {paths.transitions.length === 0 ? (
          <EmptyNote>Not enough visits in this window yet.</EmptyNote>
        ) : (
          paths.transitions.slice(0, 20).map((t) => (
            <BarRow
              key={`${t.from_page}-${t.to_page}`}
              label={
                <>
                  {eventLabel(t.from_page)} <Text style={s.tiny}>→</Text> {eventLabel(t.to_page)}
                </>
              }
              value={t.moves}
              max={paths.transitions[0].moves}
            />
          ))
        )}
      </AdminSection>

      <AdminSection title="Where Visits Start">
        {paths.entries.length === 0 ? (
          <EmptyNote>No visits yet.</EmptyNote>
        ) : (
          paths.entries.map((e) => <BarRow key={e.event_name} label={eventLabel(e.event_name)} value={e.sessions} max={paths.entries[0].sessions} />)
        )}
      </AdminSection>

      <AdminSection title="Where Visits End" hint="Bounces are visits that only saw that one page.">
        {paths.exits.length === 0 ? (
          <EmptyNote>No visits yet.</EmptyNote>
        ) : (
          paths.exits.map((e) => (
            <BarRow
              key={e.event_name}
              label={eventLabel(e.event_name)}
              value={e.sessions}
              max={paths.exits[0].sessions}
              right={`${e.sessions}${e.bounces ? ` · ${e.bounces} bounced` : ''}`}
            />
          ))
        )}
      </AdminSection>

      <AdminSection title="Feature Usage" hint="A small, deliberately curated set — not every click (see ANALYTICS_EVENTS.md).">
        {features.features.length === 0 ? (
          <EmptyNote>No feature events recorded in this window yet.</EmptyNote>
        ) : (
          features.features.map((f, i) => (
            <Divided key={f.event_name} index={i}>
              <View style={s.between}>
                <Text style={s.body}>{eventLabel(f.event_name)}</Text>
                <Text style={s.small}>
                  {f.uses} uses · {f.unique_owners} people
                </Text>
              </View>
            </Divided>
          ))
        )}
      </AdminSection>
    </>
  );
}

const styles = StyleSheet.create({
  track: { height: 12, borderRadius: 6, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.1)' },
  fill: { height: '100%', borderRadius: 6, shadowColor: '#38bdf8', shadowRadius: 6, shadowOffset: { width: 0, height: 0 } },
});
