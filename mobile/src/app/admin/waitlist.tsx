import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { Linking, Pressable, View } from 'react-native';

import { AdminScreen, AdminSection, adminStyles as s, BarRow, Divided, EmptyNote, Pill, StatTile, TileGrid, timeAgo } from '@/components/admin/AdminUI';
import { Text } from '@/components/Text';
import { LoadingState } from '@/components/ui';
import { api } from '@/lib/api';
import type { WaitlistSignup } from '@/lib/adminTypes';

const PLATFORM: Record<string, string> = { espn: 'ESPN', sleeper: 'Sleeper', yahoo: 'Yahoo', nfl: 'NFL.com', other: 'Other', none: 'New league' };

// The 2027 waitlist (2026-10-24): everyone who signed up on the public
// /waitlist page, where every "Get this for your league" share link lands.
// Who they are, how big their league is, where they play now and which
// share brought them. Same as the web's Admin > Waitlist.
export default function AdminWaitlistScreen() {
  const q = useQuery({ queryKey: ['admin', 'waitlist'], queryFn: api.admin.waitlist });
  const data = q.data;

  return (
    <AdminScreen>
      <Stack.Screen options={{ title: 'Waitlist' }} />
      {!data ? (
        q.isPending ? <LoadingState /> : <Text style={s.error}>Couldn&apos;t load the waitlist.</Text>
      ) : (
        <>
          <TileGrid>
            <StatTile label="Signups" value={String(data.count)} />
            <StatTile label="Commissioners" value={String(data.commissioners)} />
            <StatTile label="Players in their leagues" value={String(data.players_represented)} />
          </TileGrid>
          <Breakdown title="Where they play now" rows={data.signups} keyOf={(x) => PLATFORM[x.platform ?? ''] ?? 'Didn’t say'} />
          <Breakdown title="What brought them" rows={data.signups} keyOf={(x) => refLabel(x.ref)} />
          <AdminSection title="Everyone" hint="Newest first. Tap an email to write to them.">
            {data.signups.length === 0 ? (
              <EmptyNote>No signups yet. Every share from the app links to the waitlist page.</EmptyNote>
            ) : (
              data.signups.map((x, i) => (
                <Divided key={x.id} index={i}>
                  <View style={{ gap: 3, paddingVertical: 8 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <Pressable onPress={() => void Linking.openURL(`mailto:${x.email}`)} accessibilityRole="link">
                        <Text style={s.body}>{x.name ? `${x.name} · ${x.email}` : x.email}</Text>
                      </Pressable>
                      <Pill tone={x.role === 'commissioner' ? 'good' : 'default'}>{x.role === 'commissioner' ? 'Commissioner' : 'Player'}</Pill>
                    </View>
                    <Text style={s.small}>
                      {[x.league_size ? `${x.league_size} teams` : null, PLATFORM[x.platform ?? ''], refLabel(x.ref), timeAgo(x.created_at)]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                    {x.note ? <Text style={s.small}>“{x.note}”</Text> : null}
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

function refLabel(ref: string | null): string {
  if (!ref) return 'Direct';
  if (ref.startsWith('share-')) return `Shared: ${ref.slice(6).replace(/-/g, ' ')}`;
  return ref.replace(/-/g, ' ');
}

function Breakdown({ title, rows, keyOf }: { title: string; rows: WaitlistSignup[]; keyOf: (x: WaitlistSignup) => string }) {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(keyOf(r), (counts.get(keyOf(r)) ?? 0) + 1);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) return null;
  const max = sorted[0][1];
  return (
    <AdminSection title={title}>
      {sorted.map(([label, n]) => (
        <BarRow key={label} label={label} value={n} max={max} right={String(n)} />
      ))}
    </AdminSection>
  );
}
