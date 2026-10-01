import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { View } from 'react-native';

import { AdminScreen, AdminSection, adminStyles as s, BarRow, Divided, EmptyNote, formatWhen, Pill, StatTile, TileGrid } from '@/components/admin/AdminUI';
import { Text } from '@/components/Text';
import { LoadingState } from '@/components/ui';
import { api } from '@/lib/api';

const SOURCE_LABELS: Record<string, string> = { push: 'from the push', home: 'on Home', page: 'on its page' };

// Port of the web's Admin > Recaps: each week's recap — when it went
// live at the Tuesday flip, how many got the LIVE NOW push, who read it
// (opened its page or expanded it on Home) and who hasn't.
export default function AdminRecapsScreen() {
  const q = useQuery({ queryKey: ['admin', 'recaps'], queryFn: api.admin.recaps });
  const data = q.data;
  const latest = data?.weeks[0];
  const readRate = latest && latest.member_count > 0 ? Math.round((latest.readers.length / latest.member_count) * 100) : null;

  return (
    <AdminScreen>
      <Stack.Screen options={{ title: 'Recaps' }} />
      {!data ? (
        q.isPending ? <LoadingState /> : <Text style={s.error}>Couldn&apos;t load recap stats.</Text>
      ) : (
        <>
          <Text style={s.small}>
            {data.league_name ?? 'League'} · {data.season}. A recap goes live at the Tuesday flip with a push to everyone who has League
            notifications on. A read is opening its page or expanding it on Home.
          </Text>
          {!latest ? (
            <AdminSection title="Recaps">
              <EmptyNote>No recap has gone live yet this season. The next one will show up here after the Tuesday flip.</EmptyNote>
            </AdminSection>
          ) : (
            <>
              <TileGrid>
                <StatTile label={`Week ${latest.week} readers`} value={`${latest.readers.length}/${latest.member_count}`} />
                <StatTile
                  label="Read rate"
                  value={readRate === null ? '—' : `${readRate}%`}
                  tone={readRate === null ? 'default' : readRate >= 60 ? 'good' : readRate >= 30 ? 'warn' : 'bad'}
                />
                <StatTile label="Pushed" value={latest.notified} hint="got LIVE NOW" />
                <StatTile label="Via the push" value={latest.readers.filter((r) => r.source === 'push').length} hint="opened from it" />
              </TileGrid>
              {data.weeks.map((w) => (
                <AdminSection
                  key={w.week}
                  title={`Week ${w.week} Recap`}
                  hint={w.released_at ? `Went live ${formatWhen(w.released_at)} · pushed to ${w.notified}` : 'Read before release tracking began'}>
                  <BarRow label="Read it" value={w.readers.length} max={Math.max(1, w.member_count)} right={`${w.readers.length} of ${w.member_count}`} />
                  {w.readers.map((r, i) => (
                    <Divided key={r.owner_id} index={i}>
                      <View style={s.between}>
                        <View style={[s.row, s.flex]}>
                          <Text style={s.medium}>{r.display_name}</Text>
                          {r.source === 'push' && <Pill tone="good">push</Pill>}
                        </View>
                        <Text style={[s.small, s.right]}>
                          {formatWhen(r.first_opened_at)} {r.source ? (SOURCE_LABELS[r.source] ?? '') : ''}
                          {r.opens > 1 ? ` · ${r.opens} opens` : ''}
                        </Text>
                      </View>
                    </Divided>
                  ))}
                  {w.not_read.length > 0 && <Text style={s.small}>Hasn&apos;t read it: {w.not_read.map((m) => m.display_name).join(', ')}</Text>}
                </AdminSection>
              ))}
            </>
          )}
        </>
      )}
    </AdminScreen>
  );
}
