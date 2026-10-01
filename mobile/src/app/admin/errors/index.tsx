import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { AdminScreen, AdminSection, adminStyles as s, Divided, EmptyNote, Pill, StatTile, TileGrid, timeAgo, WindowPicker } from '@/components/admin/AdminUI';
import { Text } from '@/components/Text';
import { LoadingState } from '@/components/ui';
import { api } from '@/lib/api';
import type { AdminErrorGroup } from '@/lib/adminTypes';

const NEW_WINDOW_MS = 24 * 60 * 60 * 1000;

function isNew(group: AdminErrorGroup): boolean {
  const first = group.first_ever ?? group.first_seen;
  return Date.now() - new Date(first).getTime() < NEW_WINDOW_MS;
}

// Port of the web's AdminErrors list; a row opens /admin/errors/[fp].
export default function AdminErrorsScreen() {
  const [days, setDays] = useState(7);
  const q = useQuery({ queryKey: ['admin', 'errors', days], queryFn: () => api.admin.errors(days), placeholderData: keepPreviousData });
  const data = q.data;
  return (
    <AdminScreen>
      <Stack.Screen options={{ title: 'Errors' }} />
      <View style={s.between}>
        <Text style={[s.small, s.flex]}>New errors send you a push alert (at most once every 6 hours per error).</Text>
        <WindowPicker value={days} onChange={setDays} disabled={q.isFetching} options={[1, 7, 30]} />
      </View>
      {!data ? (
        q.isPending ? <LoadingState /> : <Text style={s.error}>Couldn&apos;t load errors.</Text>
      ) : (
        <>
          <TileGrid>
            <StatTile label="Distinct errors" value={data.kinds} tone={data.kinds ? 'warn' : 'good'} />
            <StatTile label="Occurrences" value={data.occurrences} />
            <StatTile label="In the app" value={data.client} hint="users' devices" />
            <StatTile label="On the server" value={data.server} tone={data.server ? 'bad' : 'default'} />
          </TileGrid>
          <AdminSection title="Errors" hint="Most recent first. Tap one for every occurrence and its stack trace.">
            {data.groups.length === 0 ? (
              <EmptyNote>No errors in this window. 🎉</EmptyNote>
            ) : (
              data.groups.map((g, i) => (
                <Divided key={g.fingerprint} index={i}>
                  <Pressable onPress={() => router.push({ pathname: '/admin/errors/[fp]', params: { fp: g.fingerprint } })} style={{ gap: 4 }}>
                    <View style={[s.row, { flexWrap: 'wrap', gap: 6 }]}>
                      <Pill tone={g.source === 'server' ? 'bad' : 'warn'}>{g.source === 'server' ? 'server' : 'app'}</Pill>
                      {isNew(g) && <Pill tone="bad">new</Pill>}
                    </View>
                    <Text style={s.mono}>{g.message}</Text>
                    <Text style={s.small}>
                      {g.route ? `${g.route} · ` : ''}
                      {g.occurrences}× · {g.affected} {g.affected === 1 ? 'person' : 'people'} · last {timeAgo(g.last_seen)}
                    </Text>
                  </Pressable>
                </Divided>
              ))
            )}
          </AdminSection>
        </>
      )}
    </AdminScreen>
  );
}
