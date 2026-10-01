import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { AdminScreen, AdminSection, adminStyles as s, Divided, EmptyNote, formatDuration, formatWhen, WindowPicker } from '@/components/admin/AdminUI';
import { Text } from '@/components/Text';
import { LoadingState } from '@/components/ui';
import { api } from '@/lib/api';

// Port of the web's AdminCrashes.
export default function AdminCrashesScreen() {
  const [days, setDays] = useState(30);
  const q = useQuery({ queryKey: ['admin', 'crashes', days], queryFn: () => api.admin.crashes(days), placeholderData: keepPreviousData });
  const data = q.data;
  return (
    <AdminScreen>
      <Stack.Screen options={{ title: 'Crashes' }} />
      {!data ? (
        q.isPending ? <LoadingState /> : <Text style={s.error}>Couldn&apos;t load crash reports.</Text>
      ) : (
        <>
          <View style={s.between}>
            <Text style={s.small}>
              {data.crashes} crashes · {data.affected_owners} people affected
            </Text>
            <WindowPicker value={days} onChange={setDays} disabled={q.isFetching} />
          </View>
          <Text style={s.small}>
            A crash is a page that died while someone was looking at it — on iPhones, almost always the app being shut down for using
            too much memory. It&apos;s reported the next time that person opens the app.
          </Text>
          {data.crashes === 0 ? (
            <AdminSection title="Crashes">
              <EmptyNote>No crashes reported in this window.</EmptyNote>
            </AdminSection>
          ) : (
            <>
              <AdminSection title="By Page">
                {data.by_route.map((r, i) => (
                  <Divided key={r.route} index={i}>
                    <View style={s.between}>
                      <Text style={[s.mono, s.flex]}>{r.route}</Text>
                      <Text style={s.small}>
                        {r.crashes} · {r.affected_owners} people
                      </Text>
                    </View>
                  </Divided>
                ))}
              </AdminSection>
              <AdminSection title="By Device" hint="Screen size and pixel ratio — 375x667@2 is an iPhone 6/7/8/SE.">
                {data.by_device.map((d, i) => (
                  <Divided key={`${d.os}|${d.screen}`} index={i}>
                    <View style={s.between}>
                      <Text style={[s.body, s.flex]}>
                        {d.os} <Text style={[s.mono, s.small]}>{d.screen}</Text>
                      </Text>
                      <Text style={s.small}>
                        {d.crashes} · {d.affected_owners} people
                      </Text>
                    </View>
                  </Divided>
                ))}
              </AdminSection>
              <AdminSection title="Recent">
                {data.recent.map((c, i) => (
                  <Divided key={`${c.created_at}-${i}`} index={i}>
                    <View style={s.between}>
                      <Text style={[s.medium, s.flex]}>{c.display_name ?? 'Unknown'}</Text>
                      <Text style={s.small}>{formatWhen(c.created_at)}</Text>
                    </View>
                    <Text style={[s.mono, { color: 'rgba(255,255,255,0.7)' }]}>{c.metadata.trail || c.route || 'unknown page'}</Text>
                    <Text style={s.small}>
                      {c.metadata.os ?? '?'} · {c.metadata.screen ?? '?'} · {c.metadata.native ? 'app' : 'browser'} · open{' '}
                      {formatDuration(c.metadata.uptime_s)} before crashing
                    </Text>
                  </Divided>
                ))}
              </AdminSection>
            </>
          )}
        </>
      )}
    </AdminScreen>
  );
}
