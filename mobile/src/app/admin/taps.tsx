import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ADMIN_ACCENT, AdminScreen, AdminSection, adminStyles as s, BarRow, Divided, EmptyNote, StatTile, TileGrid, timeAgo, WindowPicker } from '@/components/admin/AdminUI';
import { Text } from '@/components/Text';
import { Colors, Radius } from '@/constants/theme';
import { LoadingState } from '@/components/ui';
import { api } from '@/lib/api';
import { screenLabel, tapLabel } from '@/lib/tapLabels';

// Admin > Taps (2026-10-22): what members tap and change, and who.
// "What" ranks every tap (named taps in the app plus every change made
// through the API); tap one to see who. "Who" shows each person's most
// used taps and screens, so you can see what each member really uses.
export default function AdminTapsScreen() {
  const [days, setDays] = useState(30);
  const [view, setView] = useState<'what' | 'who'>('what');
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['admin', 'taps', days], queryFn: () => api.admin.taps(days) });
  const data = q.data;
  const max = Math.max(1, ...(data?.targets.map((t) => t.taps) ?? [1]));

  return (
    <AdminScreen>
      <Stack.Screen options={{ title: 'Taps' }} />
      <WindowPicker value={days} onChange={setDays} disabled={q.isFetching} />
      {!data ? (
        q.isPending ? <LoadingState /> : <Text style={s.error}>Couldn&apos;t load taps.</Text>
      ) : (
        <>
          <TileGrid>
            <StatTile label="Taps" value={data.total_taps.toLocaleString()} hint={`last ${days} days`} />
            <StatTile label="Different taps" value={data.targets.length} />
            <StatTile label="People" value={data.people.filter((p) => p.taps > 0).length} hint="tapped something" />
          </TileGrid>
          <View style={s.row}>
            {(['what', 'who'] as const).map((v) => (
              <Pressable
                key={v}
                onPress={() => setView(v)}
                accessibilityRole="button"
                accessibilityState={{ selected: view === v }}
                style={[styles.toggle, view === v && styles.toggleOn]}>
                <Text style={[styles.toggleText, view === v && styles.toggleTextOn]}>{v === 'what' ? 'What gets used' : 'Who uses what'}</Text>
              </Pressable>
            ))}
          </View>
          {view === 'what' ? (
            <AdminSection title="Most tapped" hint="Tap a row to see who. “Did:” rows are changes made in the app, like a claim or a bet.">
              {data.targets.length === 0 ? (
                <EmptyNote>No taps yet in this window. They start counting from this update.</EmptyNote>
              ) : (
                data.targets.map((t, i) => (
                  <Divided key={t.target} index={i}>
                    <Pressable onPress={() => setOpen(open === t.target ? null : t.target)} accessibilityRole="button" accessibilityState={{ expanded: open === t.target }}>
                      <BarRow label={tapLabel(t.target)} value={t.taps} max={max} right={`${t.taps} · ${t.unique_people} ${t.unique_people === 1 ? 'person' : 'people'}`} />
                    </Pressable>
                    {open === t.target &&
                      t.people.map((p) => (
                        <View key={p.owner_id} style={s.between}>
                          <Text style={[s.small, s.flex]}>{p.display_name}</Text>
                          <Text style={[s.small, s.right]}>
                            {p.taps}× · last {timeAgo(p.last_at)}
                          </Text>
                        </View>
                      ))}
                  </Divided>
                ))
              )}
            </AdminSection>
          ) : (
            <AdminSection title="Who uses what" hint="Each person's most used taps and screens in this window.">
              {data.people.length === 0 ? (
                <EmptyNote>Nobody has used the app in this window.</EmptyNote>
              ) : (
                data.people.map((p, i) => (
                  <Divided key={p.owner_id} index={i}>
                    <View style={s.between}>
                      <Text style={[s.medium, s.flex]}>{p.display_name}</Text>
                      <Text style={[s.small, s.right]}>
                        {p.taps} taps · {p.views} screens
                      </Text>
                    </View>
                    {p.top_taps.length > 0 && (
                      <Text style={s.small}>Taps: {p.top_taps.slice(0, 5).map((t) => `${tapLabel(t.target)} (${t.taps})`).join(', ')}</Text>
                    )}
                    {p.top_screens.length > 0 && (
                      <Text style={s.tiny}>Screens: {p.top_screens.slice(0, 5).map((v) => `${screenLabel(v.screen)} (${v.views})`).join(', ')}</Text>
                    )}
                  </Divided>
                ))
              )}
            </AdminSection>
          )}
        </>
      )}
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  toggle: { borderRadius: Radius.pill, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', backgroundColor: Colors.surface, paddingHorizontal: 12, paddingVertical: 6 },
  toggleOn: { borderColor: ADMIN_ACCENT, backgroundColor: 'rgba(56,189,248,0.12)' },
  toggleText: { color: 'rgba(255,255,255,0.6)', fontSize: 13, fontWeight: '600' },
  toggleTextOn: { color: Colors.text },
});
