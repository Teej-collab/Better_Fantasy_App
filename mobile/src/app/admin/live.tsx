import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AdminScreen, AdminSection, adminStyles as s, Divided, EmptyNote, Pill, platformLabel, StatTile, TileGrid, timeAgo } from '@/components/admin/AdminUI';
import { Text } from '@/components/Text';
import { LoadingState } from '@/components/ui';
import { api } from '@/lib/api';
import { eventLabel } from '@/lib/analyticsEvents';

// Port of the web's AdminLive: who's in the app right now and a running
// feed of page views and actions. Refreshes every 10 seconds while open
// (react-query pauses it while the app is in the background).
export default function AdminLiveScreen() {
  const q = useQuery({ queryKey: ['admin', 'live'], queryFn: api.admin.live, refetchInterval: 10_000 });
  const data = q.data;
  return (
    <AdminScreen>
      <Stack.Screen options={{ title: 'Live' }} />
      {!data ? (
        q.isPending ? <LoadingState /> : <Text style={s.error}>Couldn&apos;t load live activity.</Text>
      ) : (
        <>
          <TileGrid>
            <StatTile label="In the app now" value={data.people.filter((p) => p.connected).length} live />
            <StatTile label="People, last hour" value={data.last_hour.owners} />
            <StatTile label="Events, last hour" value={data.last_hour.events} />
          </TileGrid>

          <AdminSection title="Right Now" hint="Everyone with the app open, plus anyone who opened a page in the last 5 minutes.">
            {data.people.length === 0 ? (
              <EmptyNote>Nobody&apos;s in the app right now.</EmptyNote>
            ) : (
              data.people.map((p, i) => (
                <Divided key={p.owner_id} index={i}>
                  <View style={s.row}>
                    <View style={[styles.dot, { backgroundColor: p.connected ? '#10b981' : 'rgba(255,255,255,0.25)' }]} />
                    <View style={s.flex}>
                      <Text style={s.medium}>{p.display_name}</Text>
                      <Text style={s.small}>
                        {p.event_name ? eventLabel(p.event_name) : 'Unknown page'}
                        {p.route ? <Text style={[s.small, { fontFamily: s.mono.fontFamily }]}> · {p.route}</Text> : null}
                      </Text>
                    </View>
                    <View>
                      {p.platform && <Text style={[s.small, s.right]}>{platformLabel(p.platform)}</Text>}
                      <Text style={[s.small, s.right]}>{timeAgo(p.last_seen)}</Text>
                    </View>
                  </View>
                </Divided>
              ))
            )}
          </AdminSection>

          <AdminSection title="Activity Feed" hint="The latest 40 page views and tracked actions, across everyone.">
            {data.feed.length === 0 ? (
              <EmptyNote>No activity yet.</EmptyNote>
            ) : (
              data.feed.map((e, i) => (
                <Divided key={`${e.created_at}-${i}`} index={i}>
                  <View style={s.row}>
                    <Text style={[s.tiny, styles.when]}>{timeAgo(e.created_at)}</Text>
                    <Text style={[s.body, s.flex]}>
                      <Text style={s.medium}>{e.display_name ?? 'Someone'}</Text>{' '}
                      <Text style={s.soft}>
                        {e.event_type === 'page_view' ? 'opened' : 'did'} {eventLabel(e.event_name)}
                      </Text>
                    </Text>
                    {e.event_name === 'app_crash' ? <Pill tone="bad">crash</Pill> : e.event_type === 'feature' ? <Pill>action</Pill> : null}
                  </View>
                </Divided>
              ))
            )}
          </AdminSection>
        </>
      )}
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  dot: { width: 8, height: 8, borderRadius: 4 },
  when: { width: 60, fontVariant: ['tabular-nums'] },
});
