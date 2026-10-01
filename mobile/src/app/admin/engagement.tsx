import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import {

  AdminScreen,
  AdminSection,
  adminStyles as s,
  BarRow,
  dayLabel,
  EmptyNote,
  formatDuration,
  LineChart,
  pct,
  platformLabel,
  StatTile,
  TileGrid,
  WindowPicker,
} from '@/components/admin/AdminUI';
import { Display, Text } from '@/components/Text';
import { LoadingState } from '@/components/ui';
import { api } from '@/lib/api';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOUR_LABELS: Record<number, string> = { 0: '12a', 6: '6a', 12: '12p', 18: '6p' };

type Tone = 'good' | 'warn' | 'bad' | 'default';
const TONE_COLOR: Record<Tone, string> = { good: '#10b981', warn: '#f59e0b', bad: '#ef4444', default: '#eceef1' };

function rateTone(rate: number | null): Tone {
  if (rate === null) return 'default';
  if (rate >= 0.6) return 'good';
  if (rate >= 0.3) return 'warn';
  return 'bad';
}

// Stickiness runs much lower than retention for a healthy app.
function stickinessTone(rate: number | null): Tone {
  if (rate === null) return 'default';
  if (rate >= 0.4) return 'good';
  if (rate >= 0.2) return 'warn';
  return 'bad';
}

// 56,189,248 is ADMIN_ACCENT as rgb.
const accentAlpha = (a: number) => `rgba(56,189,248,${a.toFixed(2)})`;

// Port of the web's AdminEngagement.
export default function AdminEngagementScreen() {
  const [days, setDays] = useState(30);
  const q = useQuery({ queryKey: ['admin', 'engagement', days], queryFn: () => api.admin.engagement(days), placeholderData: keepPreviousData });
  const data = q.data;

  return (
    <AdminScreen>
      <Stack.Screen options={{ title: 'Engagement' }} />
      <View style={s.between}>
        <Text style={[s.small, s.flex]}>People are counted per team; days run on Central time.</Text>
        <WindowPicker value={days} onChange={setDays} disabled={q.isFetching} />
      </View>
      {!data ? (
        q.isPending ? <LoadingState /> : <Text style={s.error}>Couldn&apos;t load engagement.</Text>
      ) : (
        <Body data={data} />
      )}
    </AdminScreen>
  );
}

function Body({ data }: { data: NonNullable<Awaited<ReturnType<typeof api.admin.engagement>>> }) {
  const sm = data.summary;
  const heat = new Map(data.when_active.map((c) => [`${c.dow}-${c.hour}`, c.events]));
  const heatMax = Math.max(1, ...data.when_active.map((c) => c.events));
  const platformMax = Math.max(1, ...data.platforms.map((p) => p.owners));
  const funnelTop = data.funnel[0]?.count || 1;

  return (
    <>
      <TileGrid>
        <StatTile label="Active today" value={sm.dau} />
        <StatTile label="Active this week" value={sm.wau} hint="last 7 days" />
        <StatTile label="Active this month" value={sm.mau} hint="last 30 days" />
        <StatTile
          label="Stickiness"
          value={pct(sm.stickiness)}
          hint={`${sm.avg_dau} of ${sm.mau} people open it on a typical day`}
          tone={stickinessTone(sm.stickiness)}
        />
        <StatTile label="Sessions" value={sm.sessions.toLocaleString()} hint={`last ${data.window_days} days`} />
        <StatTile label="Pages / session" value={sm.avg_pages_per_session} />
        <StatTile label="Typical session" value={formatDuration(sm.median_session_seconds)} hint="median" />
      </TileGrid>

      <AdminSection
        title="Active People Over Time"
        hint="Daily, plus rolling 7-day and 30-day unique counts. Stickiness is the share of this month's people who show up on a typical day.">
        <LineChart
          labels={data.series.map((d) => dayLabel(d.day))}
          series={[
            { label: 'Month', color: '#a78bfa', values: data.series.map((d) => d.mau) },
            { label: 'Week', color: '#22d3ee', values: data.series.map((d) => d.wau) },
            { label: 'Day', color: '#39ff14', values: data.series.map((d) => d.dau) },
          ]}
        />
      </AdminSection>

      <AdminSection title="When the League Is Active" hint="Page views by day and hour (Central). Brighter is busier.">
        {data.when_active.length === 0 ? (
          <EmptyNote>No page views in this window yet.</EmptyNote>
        ) : (
          <View style={{ gap: 2 }}>
            {DAYS.map((day, dow) => (
              <View key={day} style={styles.heatRow}>
                <Text style={styles.heatDay}>{day}</Text>
                {Array.from({ length: 24 }, (_, hour) => {
                  const v = heat.get(`${dow}-${hour}`) ?? 0;
                  return (
                    <View
                      key={hour}
                      style={[styles.heatCell, { backgroundColor: v ? accentAlpha(0.12 + 0.88 * (v / heatMax)) : 'rgba(255,255,255,0.05)' }]}
                    />
                  );
                })}
              </View>
            ))}
            <View style={styles.heatRow}>
              <View style={styles.heatDay} />
              {Array.from({ length: 24 }, (_, hour) => (
                <Text key={hour} style={styles.heatHour} numberOfLines={1}>
                  {HOUR_LABELS[hour] ?? ''}
                </Text>
              ))}
            </View>
          </View>
        )}
      </AdminSection>

      <AdminSection title="Retention" hint="Of accounts old enough, the share still using the app after that many days.">
        <View style={s.row}>
          {data.retention.map((r) => (
            <View key={r.day} style={styles.retention}>
              <Text style={styles.retentionLabel}>Day {r.day}</Text>
              <Display style={[styles.retentionValue, { color: TONE_COLOR[rateTone(r.rate)] }]}>{pct(r.rate)}</Display>
              <Text style={s.tiny}>
                {r.retained}/{r.eligible} people
              </Text>
            </View>
          ))}
        </View>
      </AdminSection>

      <AdminSection title="Signup Funnel" hint="All time — where people drop off between signing up and sticking around.">
        {data.funnel.map((f, i) => {
          const prev = i > 0 ? data.funnel[i - 1].count : null;
          const drop = prev ? Math.round((1 - f.count / prev) * 100) : null;
          return (
            <BarRow
              key={f.step}
              label={f.label}
              value={f.count}
              max={funnelTop}
              right={
                <>
                  {f.count}
                  {drop !== null && drop > 0 ? <Text style={{ color: '#ef4444' }}> −{drop}%</Text> : null}
                </>
              }
            />
          );
        })}
      </AdminSection>

      <AdminSection
        title="Signup Cohorts"
        hint="Accounts grouped by the week they signed up, and the share active in each week after. Blank means that week hasn't happened yet.">
        {data.cohorts.length === 0 ? (
          <EmptyNote>No signups in the last 8 weeks.</EmptyNote>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View>
              <View style={styles.cohortRow}>
                <Text style={[styles.th, styles.cohortWeek]}>Week of</Text>
                <Text style={[styles.th, styles.cohortSize]}>People</Text>
                {[1, 2, 3, 4].map((w) => (
                  <Text key={w} style={[styles.th, styles.cohortCell, { textAlign: 'center' }]}>
                    Wk {w}
                  </Text>
                ))}
              </View>
              {data.cohorts.map((c) => (
                <View key={c.week} style={[styles.cohortRow, styles.cohortDivided]}>
                  <Text style={[s.body, styles.cohortWeek]}>{dayLabel(c.week)}</Text>
                  <Text style={[s.body, styles.cohortSize]}>{c.size}</Text>
                  {c.weeks.map((rate, i) => (
                    <View key={i} style={[styles.cohortCell, styles.cohortFill, rate !== null && { backgroundColor: accentAlpha((10 + rate * 60) / 100) }]}>
                      <Text style={styles.cohortText}>{rate === null ? '' : pct(rate)}</Text>
                    </View>
                  ))}
                </View>
              ))}
            </View>
          </ScrollView>
        )}
      </AdminSection>

      <AdminSection title="Devices" hint={`People and events by platform, last ${data.window_days} days.`}>
        {data.platforms.length === 0 ? (
          <EmptyNote>No activity in this window.</EmptyNote>
        ) : (
          data.platforms.map((p) => (
            <BarRow
              key={`${p.platform}-${p.device_type}`}
              label={platformLabel(p.platform, p.device_type)}
              value={p.owners}
              max={platformMax}
              right={`${p.owners} people · ${p.events.toLocaleString()} events`}
            />
          ))
        )}
      </AdminSection>
    </>
  );
}

const styles = StyleSheet.create({
  heatRow: { flexDirection: 'row', alignItems: 'center', gap: 1 },
  heatDay: { width: 30, color: 'rgba(255,255,255,0.5)', fontSize: 10 },
  heatCell: { flex: 1, height: 14, borderRadius: 2 },
  heatHour: { flex: 1, color: 'rgba(255,255,255,0.4)', fontSize: 8, overflow: 'visible' },
  retention: { flex: 1, alignItems: 'center', gap: 2, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.04)', padding: 8 },
  retentionLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 10, fontWeight: '600', textTransform: 'uppercase' },
  retentionValue: { fontSize: 20, letterSpacing: 0, fontVariant: ['tabular-nums'] },
  cohortRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  cohortDivided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.06)' },
  th: { color: 'rgba(255,255,255,0.5)', fontSize: 10, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase' },
  cohortWeek: { width: 76 },
  cohortSize: { width: 56 },
  cohortCell: { width: 56, marginHorizontal: 1 },
  cohortFill: { borderRadius: 4, paddingVertical: 4 },
  cohortText: { color: '#eceef1', fontSize: 12, textAlign: 'center', fontVariant: ['tabular-nums'] },
});

