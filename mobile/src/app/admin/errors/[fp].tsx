import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AdminScreen, AdminSection, adminStyles as s, BarRow, dayLabel, Divided, EmptyNote, formatWhen } from '@/components/admin/AdminUI';
import { Text } from '@/components/Text';
import { api } from '@/lib/api';

// Port of the web's ErrorDetail: one error's recent occurrences with
// their stack traces, plus its last 30 days.
export default function AdminErrorScreen() {
  const { fp } = useLocalSearchParams<{ fp: string }>();
  const q = useQuery({ queryKey: ['admin', 'error', fp], queryFn: () => api.admin.error(fp) });
  const [open, setOpen] = useState<number | null>(0);
  const detail = q.data;
  const latest = detail?.occurrences[0];
  const dailyMax = Math.max(1, ...(detail?.daily.map((d) => d.occurrences) ?? [0]));

  return (
    <AdminScreen>
      <Stack.Screen options={{ title: 'Error' }} />
      {q.isError ? (
        <EmptyNote>Couldn&apos;t load this error — it may be older than what&apos;s kept.</EmptyNote>
      ) : !detail || !latest ? (
        <EmptyNote>Loading…</EmptyNote>
      ) : (
        <>
          <AdminSection title={latest.source === 'server' ? 'Server error' : 'App error'}>
            <Text style={[s.mono, { fontSize: 13 }]}>{latest.message}</Text>
            <Text style={s.small}>
              {detail.occurrences.length}
              {detail.occurrences.length === 50 ? '+' : ''} recent occurrences · id {fp}
            </Text>
          </AdminSection>

          {detail.daily.length > 1 && (
            <AdminSection title="Last 30 Days">
              {detail.daily.map((d) => (
                <BarRow key={d.day} label={dayLabel(d.day)} value={d.occurrences} max={dailyMax} color="#ef4444" />
              ))}
            </AdminSection>
          )}

          <AdminSection title="Occurrences" hint="Newest first. Tap one to see its stack trace.">
            {detail.occurrences.map((o, i) => (
              <Divided key={`${o.created_at}-${i}`} index={i}>
                <Pressable onPress={() => setOpen(open === i ? null : i)} style={{ gap: 2 }}>
                  <View style={s.between}>
                    <Text style={[s.medium, s.flex]}>{o.who ?? 'Signed-out visitor'}</Text>
                    <Text style={s.small}>{formatWhen(o.created_at)}</Text>
                  </View>
                  <Text style={s.small}>{[o.method, o.route, o.status_code, o.os, o.screen].filter(Boolean).join(' · ') || '—'}</Text>
                </Pressable>
                {open === i && (
                  <ScrollView style={styles.stack} nestedScrollEnabled>
                    <Text style={styles.stackText} selectable>
                      {o.stack || 'No stack trace was captured for this one.'}
                    </Text>
                  </ScrollView>
                )}
              </Divided>
            ))}
          </AdminSection>
        </>
      )}
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  stack: { maxHeight: 320, marginTop: 8, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.4)', padding: 8 },
  stackText: { color: 'rgba(255,255,255,0.85)', fontSize: 11, lineHeight: 15, fontFamily: s.mono.fontFamily },
});
